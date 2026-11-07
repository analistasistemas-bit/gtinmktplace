// Máquina de estados do envio de mensagem pós-venda por pack no ML. Deps injetadas (banco e ML): a edge
// `responder-mensagem` passa as reais; o vitest, um banco em memória com as mesmas unicidades e
// condicionais. Sem Deno/npm. Mesma tabela e mesmos estados de `posvenda-fluxo.ts`, com `pack_id` no
// lugar de `claim_id`.
//
// Regras que este arquivo garante:
// - Mensagem nunca sai duas vezes: só `enviar` faz POST, e só depois de ganhar a reserva (`post_em`
//   gravado por update condicional). Repetição do mesmo `operacao_id` nunca chega em `enviar`.
// - A trava (índice único parcial em reservada|enviada|desconhecido) só sai sem confirmação por prova
//   de não entrega ou pelo operador (`liberarEnvio`), depois de conferir no ML.
import { classificar, ESTADOS_ATIVOS, MSG_MODERACAO, MSG_TRAVA, sha256, type EstadoAcao } from './posvenda-fluxo.ts';

export type EstadoEnvio = EstadoAcao;

export const MSG_LIBERADO = 'Liberado pelo operador após conferir no Mercado Livre.';
const RESERVA_EXPIRA_MS = 2 * 60_000;

export interface PayloadMensagem { texto: string; anexo: string | null }
export interface MsgConversa { id: string; deVendedor: boolean; texto: string; anexos: string[]; moderacao: string | null }

/** Linha de `ml_posvenda_acoes` com alvo `pack_id`. */
export interface TentativaMensagem {
  id: string; org_id: string; user_id: string; operacao_id: string; pack_id: string; recurso: string;
  acao: 'responder_mensagem'; payload: PayloadMensagem; payload_hash: string; antes: { ids: string[] } | null; estado: EstadoEnvio;
  post_em: string | null; http_status: number | null; resposta_ml: unknown; erro: string | null; criado_em: string;
}

/** Tudo escopado à org (e à conexão/token) por quem constrói. */
export interface DepsMensagem {
  agora(): string;
  porOperacao(op: string): Promise<TentativaMensagem | null>;
  /** Insert `reservada`. 23505 no índice de operação/trava vira o literal correspondente. */
  inserir(t: Pick<TentativaMensagem, 'org_id' | 'user_id' | 'operacao_id' | 'pack_id' | 'recurso' | 'acao' | 'payload' | 'payload_hash'>):
    Promise<TentativaMensagem | 'conflito_operacao' | 'conflito_recurso'>;
  ativaDoRecurso(recurso: string): Promise<TentativaMensagem | null>;
  /** Update condicional; null = 0 linhas (outra execução ganhou). */
  atualizar(id: string, onde: { estado: EstadoEnvio; postEmNulo?: boolean }, set: Partial<TentativaMensagem>): Promise<TentativaMensagem | null>;
  /** Lança se não leu. */
  lerConversa(): Promise<MsgConversa[]>;
  /** POST com timeout. `status: null` = timeout/rede (não se sabe se o ML recebeu). */
  postML(p: PayloadMensagem): Promise<{ status: number | null; body: unknown }>;
  erroRecusa(status: number, body: unknown): string;
}

export interface ResultadoEnvio {
  http: number; ok: boolean; estado: EstadoEnvio | null; operacao_id?: string; pendenteConfirmacao: boolean;
  erro?: string; codigo?: string; pendente?: { operacao_id: string; estado: EstadoEnvio } | null;
}

const falha = (http: number, erro: string, codigo?: string): ResultadoEnvio => ({
  http, ok: false, estado: null, pendenteConfirmacao: false, erro, ...(codigo ? { codigo } : {}),
});

const foraDoPack = (t: TentativaMensagem | null) =>
  t ? falha(409, 'operacao_id pertence a outra conversa.') : falha(404, 'Operação não encontrada.');

function resultado(t: TentativaMensagem, http?: number): ResultadoEnvio {
  const recusa = t.estado === 'recusada' || t.estado === 'cancelada';
  const codigo = t.estado === 'recusada' && (t.http_status === 401 || t.http_status === 403) ? 'reconectar'
    : t.erro === MSG_MODERACAO ? 'moderacao' : recusa ? t.estado : undefined;
  return {
    http: http ?? (t.estado === 'recusada' ? 422 : t.estado === 'cancelada' ? 409 : 200),
    ok: !recusa, estado: t.estado, operacao_id: t.operacao_id, pendenteConfirmacao: ESTADOS_ATIVOS.includes(t.estado),
    ...(t.erro ? { erro: t.erro } : {}), ...(codigo ? { codigo } : {}),
  };
}

const reler = async (deps: DepsMensagem, t: TentativaMensagem) => (await deps.porOperacao(t.operacao_id)) ?? t;

/** Evidência na conversa: exige exatamente uma mensagem nova do vendedor com o mesmo conteúdo. */
export function efeitoMensagem(antes: string[], msgs: MsgConversa[], p: PayloadMensagem, idPost: string | null): 'confirmado' | 'nao' | 'inconclusivo' {
  const anexos = JSON.stringify(p.anexo ? [p.anexo] : []);
  const candidatas = msgs.filter((m) => m.deVendedor && !antes.includes(m.id) && (idPost == null || m.id === idPost)
    && m.texto.trim() === p.texto.trim() && JSON.stringify(m.anexos) === anexos);
  if (candidatas.length !== 1) return 'inconclusivo';
  const { moderacao } = candidatas[0];
  return moderacao === 'clean' ? 'confirmado' : moderacao === 'rejected' ? 'nao' : 'inconclusivo';
}

/** Relê a conversa atrás de evidência. Nunca faz POST; falha de leitura mantém o estado. */
async function conferir(deps: DepsMensagem, t: TentativaMensagem): Promise<TentativaMensagem> {
  if ((t.estado !== 'enviada' && t.estado !== 'desconhecido') || !t.antes || !t.post_em) return t;
  let msgs: MsgConversa[];
  try { msgs = await deps.lerConversa(); } catch { return t; }
  const id = (t.resposta_ml as { id?: unknown } | null)?.id;
  const ef = efeitoMensagem(t.antes.ids, msgs, t.payload, id != null ? String(id) : null);
  if (ef === 'inconclusivo') return t;
  const set: Partial<TentativaMensagem> = ef === 'confirmado' ? { estado: 'confirmada' } : { estado: 'recusada', erro: MSG_MODERACAO };
  return await deps.atualizar(t.id, { estado: t.estado }, set) ?? await reler(deps, t);
}

/** Único lugar que faz POST. */
async function enviar(deps: DepsMensagem, t: TentativaMensagem): Promise<ResultadoEnvio> {
  let msgs: MsgConversa[];
  try { msgs = await deps.lerConversa(); } catch (err) {
    const c = await deps.atualizar(t.id, { estado: 'reservada', postEmNulo: true }, { estado: 'cancelada', erro: (err as Error).message });
    return resultado(c ?? await reler(deps, t), 502);
  }

  // post_em ANTES do fetch, condicional: sem linha = reserva cancelada pelo "Conferir" → sem POST.
  const marcada = await deps.atualizar(t.id, { estado: 'reservada', postEmNulo: true }, { post_em: deps.agora(), antes: { ids: msgs.map((m) => m.id) } });
  if (!marcada) return resultado(await reler(deps, t));

  const resp = await deps.postML(marcada.payload);
  const estado = classificar(resp.status);
  const limpa = estado === 'enviada' && (resp.body as { message_moderation?: { status?: unknown } } | null)?.message_moderation?.status === 'clean';
  const apos = await deps.atualizar(marcada.id, { estado: 'reservada' }, {
    estado: limpa ? 'confirmada' : estado, http_status: resp.status, resposta_ml: resp.body ?? null,
    erro: estado === 'recusada' ? deps.erroRecusa(resp.status!, resp.body) : null,
  });
  return resultado(await conferir(deps, apos ?? await reler(deps, marcada)));
}

export async function enviarMensagem(
  deps: DepsMensagem, e: { orgId: string; userId: string; packId: string; operacaoId: string; payload: PayloadMensagem },
): Promise<ResultadoEnvio> {
  const hash = await sha256(JSON.stringify({ packId: e.packId, payload: e.payload }));
  // Operação conhecida: nunca executa de novo.
  const repetir = (t: TentativaMensagem) => t.pack_id !== e.packId ? foraDoPack(t)
    : t.payload_hash !== hash ? falha(409, 'operacao_id já usado com outro conteúdo.') : resultado(t);
  const existente = await deps.porOperacao(e.operacaoId);
  if (existente) return repetir(existente);

  // Reserva (a trava é o índice único parcial).
  const recurso = `mensagem:${e.packId}`;
  const r = await deps.inserir({
    org_id: e.orgId, user_id: e.userId, operacao_id: e.operacaoId, pack_id: e.packId, recurso,
    acao: 'responder_mensagem', payload: e.payload, payload_hash: hash,
  });
  if (r === 'conflito_operacao') {
    const t = await deps.porOperacao(e.operacaoId);
    return t ? repetir(t) : falha(409, MSG_TRAVA, 'em_andamento');
  }
  if (r === 'conflito_recurso') {
    const p = await deps.ativaDoRecurso(recurso);
    return { ...falha(409, MSG_TRAVA, 'em_andamento'), pendente: p && { operacao_id: p.operacao_id, estado: p.estado } };
  }
  return await enviar(deps, r);
}

/** "Conferir": nunca faz POST. `reservada` recente pode estar com a edge no meio do envio → não toca. */
export async function verificarEnvio(deps: DepsMensagem, packId: string, operacaoId: string): Promise<ResultadoEnvio> {
  const t = await deps.porOperacao(operacaoId);
  if (!t || t.pack_id !== packId) return foraDoPack(t);
  if (t.estado !== 'reservada') return resultado(await conferir(deps, t));

  if (Date.parse(deps.agora()) - Date.parse(t.post_em ?? t.criado_em) <= RESERVA_EXPIRA_MS) return resultado(t);
  const c = t.post_em
    // A edge caiu entre o POST e a classificação: não se sabe se o ML recebeu.
    ? await deps.atualizar(t.id, { estado: 'reservada' }, { estado: 'desconhecido' })
    : await deps.atualizar(t.id, { estado: 'reservada', postEmNulo: true }, { estado: 'cancelada', erro: 'Reserva expirada antes do envio ao Mercado Livre.' });
  return resultado(await conferir(deps, c ?? await reler(deps, t)));
}

/** Saída manual da trava, depois que o operador conferiu no ML que não há como confirmar. */
export async function liberarEnvio(deps: DepsMensagem, packId: string, operacaoId: string): Promise<ResultadoEnvio> {
  const t = await deps.porOperacao(operacaoId);
  if (!t || t.pack_id !== packId) return foraDoPack(t);
  const c = t.estado === 'enviada' || t.estado === 'desconhecido'
    ? await deps.atualizar(t.id, { estado: t.estado }, { estado: 'inconclusiva', erro: MSG_LIBERADO })
    : null;
  return c ? resultado(c) : falha(409, 'Só um envio aguardando confirmação pode ser liberado.');
}
