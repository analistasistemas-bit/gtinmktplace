// Máquina de estados das ações de pós-venda no ML (ADR-0192, Task 5). Deps injetadas (banco e ML):
// a edge `posvenda-acao` e o passo `posvenda` do reconciliar passam as reais; o vitest, um banco em
// memória com as mesmas unicidades/condicionais. Sem Deno/npm.
//
// Regras que este arquivo garante:
// - Nenhum reenvio automático: só `enviar` faz POST, e só depois de ganhar a reserva (`post_em` gravado
//   por update condicional). Repetição do mesmo `operacao_id` nunca chega em `enviar`.
// - A trava (índice único parcial em reservada|enviada|desconhecido) só sai sem confirmação quando o
//   próprio ML não aceita mais a ação (`mlAceitaAinda`).
import {
  chaveRecurso, destinatarioResposta, efeitoConfirmado, ehAcaoPosvenda, mlAceitaAinda, montarRequisicao, validarAcao,
  type AcaoPosvenda, type CorpoAcao, type DetalheReclamacao, type Efeito, type RevisaoFalhaItem,
} from './posvenda.ts';

export type EstadoAcao = 'reservada' | 'enviada' | 'confirmada' | 'recusada' | 'desconhecido' | 'inconclusiva' | 'cancelada';
export const ESTADOS_ATIVOS: EstadoAcao[] = ['reservada', 'enviada', 'desconhecido'];

export const MSG_TRAVA = 'Outra ação está em andamento ou aguardando confirmação neste item';
export const MSG_RECONECTAR = 'Reconecte a conta do Mercado Livre em Configurações → Conexões (falta permissão de escrita)';
export const MSG_MODERACAO = 'O ML bloqueou a mensagem na moderação';
const RESERVA_EXPIRA_MS = 2 * 60_000;

/** Linha de `ml_posvenda_acoes`. */
export interface Tentativa {
  id: string; org_id: string; user_id: string; operacao_id: string;
  claim_id: number; return_id: number | null; recurso: string; acao: AcaoPosvenda;
  payload: CorpoAcao; payload_hash: string; antes: DetalheReclamacao | null; estado: EstadoAcao;
  post_em: string | null; http_status: number | null; resposta_ml: unknown; sync_pendente: boolean;
  erro: string | null; criado_em: string;
}
export type NovaTentativa = Pick<Tentativa, 'org_id' | 'user_id' | 'operacao_id' | 'claim_id' | 'return_id' | 'recurso' | 'acao' | 'payload' | 'payload_hash'>;

/** Condição do update condicional (`where id = $id and ...`). */
export interface Onde { estado: EstadoAcao; postEmNulo?: boolean; syncPendente?: boolean; criadoAntesDe?: string }

/** Tudo escopado à org (e à conexão/token) por quem constrói. */
export interface DepsAcao {
  agora(): string;
  porOperacao(operacaoId: string): Promise<Tentativa | null>;
  /** Insert `reservada`. 23505 no índice de operação/trava vira o literal correspondente. */
  inserir(t: NovaTentativa): Promise<Tentativa | 'conflito_operacao' | 'conflito_recurso'>;
  ativaDoRecurso(recurso: string): Promise<Tentativa | null>;
  /** Update condicional; null = 0 linhas (outra execução ganhou). */
  atualizar(id: string, onde: Onde, set: Partial<Tentativa>): Promise<Tentativa | null>;
  /** Linhas da org em estado ativo ou com `sync_pendente`. */
  abertas(): Promise<Tentativa[]>;
  /** Releitura completa do ML (`lerDetalheReclamacao`); lança se não leu o necessário à decisão. */
  lerDetalhe(claimId: number): Promise<DetalheReclamacao>;
  /** POST com timeout. `status: null` = timeout/rede (não se sabe se o ML recebeu). */
  postML(path: string, corpo: unknown): Promise<{ status: number | null; body: unknown }>;
  /** Re-sync estrito com o DONO da conexão + enfileira `sync-devolucao`. Lança se não completou. */
  sincronizar(claimId: number): Promise<Record<string, unknown> | null>;
}

export interface BodyAcao {
  operacao_id: string; claim_id: string; acao?: string; texto?: unknown; percentual?: unknown;
  revisoes?: unknown; anexos?: unknown; verificar?: boolean;
}
export interface Entrada {
  orgId: string; userId: string; claimId: number;
  /** `ml_devolucoes.return_id` (chave da trava de revisão antes de reler o ML). */
  returnIdLocal: number | null;
  body: BodyAcao;
}
export interface Resultado {
  http: number; ok: boolean; estado: EstadoAcao | null; pendenteConfirmacao: boolean; sincronizacaoPendente: boolean;
  devolucao: Record<string, unknown> | null; operacao_id?: string; erro?: string; codigo?: string;
  pendente?: { acao: AcaoPosvenda; estado: EstadoAcao; operacao_id: string } | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehRevisao = (a: AcaoPosvenda) => a === 'revisar_ok' || a === 'revisar_falha';

const falha = (http: number, erro: string, codigo?: string): Resultado => ({
  http, ok: false, estado: null, pendenteConfirmacao: false, sincronizacaoPendente: false, devolucao: null, erro,
  ...(codigo ? { codigo } : {}),
});

function resultado(t: Tentativa, devolucao: Record<string, unknown> | null = null, http?: number): Resultado {
  const recusa = t.estado === 'recusada' || t.estado === 'cancelada' || t.erro != null;
  const codigo = t.estado === 'recusada' && (t.http_status === 401 || t.http_status === 403) ? 'reconectar'
    : t.erro === MSG_MODERACAO ? 'moderacao' : recusa ? t.estado : undefined;
  return {
    http: http ?? (t.estado === 'recusada' || t.erro ? 422 : t.estado === 'cancelada' ? 409 : 200),
    ok: !recusa, estado: t.estado, operacao_id: t.operacao_id,
    pendenteConfirmacao: ESTADOS_ATIVOS.includes(t.estado), sincronizacaoPendente: t.sync_pendente, devolucao,
    ...(t.erro ? { erro: t.erro } : {}), ...(codigo ? { codigo } : {}),
  };
}

const lista = (v: unknown): string[] | null =>
  v == null ? [] : Array.isArray(v) && v.every((x) => typeof x === 'string') ? v : null;

/** Só os campos que a ação manda ao ML (é o que se grava e se hasheia). string = 400. */
export function normalizarCorpo(acao: AcaoPosvenda, b: BodyAcao): CorpoAcao | string {
  if (acao === 'responder') {
    const anexos = lista(b.anexos);
    if (typeof b.texto !== 'string' || !anexos) return 'texto/anexos inválidos';
    return { texto: b.texto.trim(), anexos };
  }
  if (acao === 'reembolso_parcial') {
    const p = b.percentual;
    return typeof p === 'number' && Number.isFinite(p) ? { percentual: p } : 'percentual inválido';
  }
  if (acao === 'revisar_falha') {
    if (!Array.isArray(b.revisoes)) return 'revisoes inválidas';
    const revisoes: RevisaoFalhaItem[] = [];
    for (const r of b.revisoes as Array<Record<string, unknown> | null>) {
      const anexos = lista(r?.anexos);
      const oid = r?.order_id;
      if (!r || typeof r.motivo_id !== 'string' || typeof r.texto !== 'string' || !anexos) return 'revisoes inválidas';
      if (oid != null && !(typeof oid === 'number' && Number.isSafeInteger(oid) && oid > 0)) return 'order_id inválido';
      revisoes.push({ ...(oid != null ? { order_id: oid as number } : {}), motivo_id: r.motivo_id, texto: r.texto.trim(), anexos });
    }
    return { revisoes };
  }
  return {};
}

async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const hashDe = (acao: AcaoPosvenda, claimId: number, payload: CorpoAcao) => sha256(JSON.stringify({ acao, claimId, payload }));

/** Desfecho HTTP do POST. 408 é ambíguo (pode ter processado) → desconhecido. */
function classificar(status: number | null): EstadoAcao {
  if (status == null) return 'desconhecido';
  if (status >= 200 && status < 300) return 'enviada';
  if (status >= 400 && status < 500 && status !== 408) return 'recusada';
  return 'desconhecido';
}

function mensagemRecusa(status: number, body: unknown): string {
  if (status === 401 || status === 403) return MSG_RECONECTAR;
  const b = body as { message?: unknown; error?: unknown } | null;
  const m = typeof b?.message === 'string' ? b.message : typeof b?.error === 'string' ? b.error : null;
  return `O Mercado Livre recusou a ação${m ? `: ${m}` : ` (HTTP ${status})`}.`;
}

const reler = async (deps: DepsAcao, t: Tentativa) => (await deps.porOperacao(t.operacao_id)) ?? t;

export async function executarAcao(deps: DepsAcao, e: Entrada): Promise<Resultado> {
  const b = e.body;
  if (typeof b.operacao_id !== 'string' || !UUID.test(b.operacao_id)) return falha(400, 'operacao_id inválido');

  // 1. Operação conhecida: nunca executa de novo.
  const existente = await deps.porOperacao(b.operacao_id);
  if (existente) return await repetir(deps, existente, e);
  if (b.verificar) return falha(404, 'Operação não encontrada.');

  if (!ehAcaoPosvenda(b.acao)) return falha(400, 'acao inválida');
  const acao = b.acao;
  const payload = normalizarCorpo(acao, b);
  if (typeof payload === 'string') return falha(400, payload);
  if (ehRevisao(acao) && e.returnIdLocal == null) {
    return falha(409, 'A devolução ainda não foi sincronizada. Tente de novo em alguns minutos.');
  }
  const returnId = ehRevisao(acao) ? e.returnIdLocal : null;
  const recurso = chaveRecurso(acao, e.claimId, returnId);

  // 2. Reserva (a trava é o índice único parcial).
  const r = await deps.inserir({
    org_id: e.orgId, user_id: e.userId, operacao_id: b.operacao_id, claim_id: e.claimId, return_id: returnId,
    recurso, acao, payload, payload_hash: await hashDe(acao, e.claimId, payload),
  });
  if (r === 'conflito_operacao') {
    const t = await deps.porOperacao(b.operacao_id);
    return t ? await repetir(deps, t, e) : falha(409, MSG_TRAVA, 'em_andamento');
  }
  if (r === 'conflito_recurso') {
    const p = await deps.ativaDoRecurso(recurso);
    return { ...falha(409, MSG_TRAVA, 'em_andamento'), pendente: p && { acao: p.acao, estado: p.estado, operacao_id: p.operacao_id } };
  }
  return await enviar(deps, r);
}

async function repetir(deps: DepsAcao, t: Tentativa, e: Entrada): Promise<Resultado> {
  if (t.claim_id !== e.claimId) return falha(409, 'operacao_id pertence a outra reclamação.');
  if (!e.body.verificar) {
    const acao = e.body.acao;
    const payload = ehAcaoPosvenda(acao) ? normalizarCorpo(acao, e.body) : null;
    const hash = ehAcaoPosvenda(acao) && payload && typeof payload !== 'string' ? await hashDe(acao, e.claimId, payload) : null;
    if (hash !== t.payload_hash) return falha(409, 'operacao_id já usado com outro conteúdo.');
  }
  // 7 só: a escrita no ML já foi confirmada.
  if (t.sync_pendente) return await finalizar(deps, t);
  // 6 só ("Conferir"): reserva sem post_em ainda não fez POST — nada a conferir.
  if (e.body.verificar && ESTADOS_ATIVOS.includes(t.estado) && t.post_em) {
    return await finalizar(deps, (await conferir(deps, t)).t);
  }
  return resultado(t);
}

/** Passos 3–6. Único lugar que faz POST. */
async function enviar(deps: DepsAcao, t: Tentativa): Promise<Resultado> {
  const cancelar = async (erro: string, antes: DetalheReclamacao | null, http: number) => {
    const c = await deps.atualizar(t.id, { estado: 'reservada', postEmNulo: true }, { estado: 'cancelada', erro, antes });
    return resultado(c ?? await reler(deps, t), null, http);
  };

  // 3. Releitura (estado atual do ML, depois de ganhar a trava).
  let d: DetalheReclamacao;
  try { d = await deps.lerDetalhe(t.claim_id); }
  catch (err) { return await cancelar((err as Error).message, null, 502); }
  const motivo = ehRevisao(t.acao) && d.return_id !== t.return_id
    ? 'A devolução mudou no Mercado Livre. Recarregue a reclamação.'
    : validarAcao(t.acao, t.payload, d);
  if (motivo) return await cancelar(motivo, d, 409);

  const req = montarRequisicao(t.acao, t.claim_id, d.return_id, t.payload, destinatarioResposta(d.acoes, d.stage));
  // 4. post_em ANTES do fetch, condicional: sem linha = reserva cancelada (pelo reconciliar) → sem POST.
  const marcada = await deps.atualizar(t.id, { estado: 'reservada', postEmNulo: true }, { post_em: deps.agora(), antes: d });
  if (!marcada) return resultado(await reler(deps, t));

  const resp = await deps.postML(req.path, req.corpo);
  // 5.
  const estado = classificar(resp.status);
  const apos = await deps.atualizar(marcada.id, { estado: 'reservada' }, {
    estado, http_status: resp.status, resposta_ml: resp.body ?? null,
    erro: estado === 'recusada' ? mensagemRecusa(resp.status!, resp.body) : null,
  });
  let atual = apos ?? await reler(deps, marcada);
  // 6.
  if (atual.estado === 'enviada' || atual.estado === 'desconhecido') atual = (await conferir(deps, atual)).t;
  return await finalizar(deps, atual);
}

/** Passo 6: relê e procura evidência positiva. Nunca faz POST; falha de leitura mantém o estado. */
async function conferir(deps: DepsAcao, t: Tentativa): Promise<{ t: Tentativa; d?: DetalheReclamacao; ef?: Efeito }> {
  if (!t.antes || !t.post_em) return { t };
  let d: DetalheReclamacao;
  try { d = await deps.lerDetalhe(t.claim_id); } catch { return { t }; }
  const ef = efeitoConfirmado(t.acao, t.antes, d, { payload: t.payload, post_em: t.post_em, http_status: t.http_status });
  if (ef === 'confirmado') {
    const c = await deps.atualizar(t.id, { estado: t.estado }, { estado: 'confirmada', sync_pendente: true, erro: null });
    return { t: c ?? await reler(deps, t), d, ef };
  }
  // Mensagem bloqueada: avisa, mas a trava fica (send_message segue liberado; libera pelo reconciliar).
  if (ef === 'nao' && t.acao === 'responder' && t.erro !== MSG_MODERACAO) {
    const c = await deps.atualizar(t.id, { estado: t.estado }, { erro: MSG_MODERACAO });
    return { t: c ?? await reler(deps, t), d, ef };
  }
  return { t, d, ef };
}

/** Passo 7 (se `sync_pendente`) e a resposta. */
async function finalizar(deps: DepsAcao, t: Tentativa): Promise<Resultado> {
  if (!t.sync_pendente) return resultado(t);
  try {
    const devolucao = await deps.sincronizar(t.claim_id);
    const c = await deps.atualizar(t.id, { estado: 'confirmada', syncPendente: true }, { sync_pendente: false });
    return resultado(c ?? await reler(deps, t), devolucao);
  } catch (err) {
    console.warn(`posvenda-acao: re-sync do claim ${t.claim_id} falhou (fica pendente): ${(err as Error).message}`);
    return resultado(t);
  }
}

/** Recuperação durável do reconciliar horário (nunca reenvia). Nunca lança; devolve quantas linhas mudou. */
export async function recuperarPendentes(deps: DepsAcao): Promise<number> {
  const limite = new Date(Date.parse(deps.agora()) - RESERVA_EXPIRA_MS).toISOString();
  const velha = (iso: string) => Date.parse(iso) < Date.parse(limite);
  let n = 0;
  for (const t of await deps.abertas()) {
    try {
      if (t.sync_pendente) {
        if (!(await finalizar(deps, t)).sincronizacaoPendente) n++;
        continue;
      }
      // (a) reserva que nunca chegou ao POST. Condicional em post_em null: perde para o passo 4.
      if (t.estado === 'reservada' && t.post_em == null) {
        if (velha(t.criado_em) && await deps.atualizar(t.id, { estado: 'reservada', postEmNulo: true, criadoAntesDe: limite },
          { estado: 'cancelada', erro: 'Reserva expirada antes do envio ao Mercado Livre.' })) n++;
        continue;
      }
      // (b) houve (ou pode ter havido) POST. Recente = a edge pode estar no meio dele.
      if (!t.post_em || !velha(t.post_em)) continue;
      const { t: atual, d, ef } = await conferir(deps, t);
      if (atual.estado === 'confirmada') { await finalizar(deps, atual); n++; continue; }
      if (d && ef && !mlAceitaAinda(t.acao, d)
        && await deps.atualizar(t.id, { estado: atual.estado }, { estado: 'inconclusiva' })) n++;
    } catch (err) {
      console.warn(`posvenda: recuperar tentativa ${t.id} falhou: ${(err as Error).message}`);
    }
  }
  return n;
}
