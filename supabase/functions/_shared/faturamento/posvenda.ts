// Mapeadores puros do detalhe de reclamação/devolução (ADR-0192). Sem Deno/npm — testável.
import type { RevisaoML } from './devolucao.ts';

export type Autor = 'comprador' | 'vendedor' | 'ml';

export interface MensagemHistorico {
  data: string;
  autor: Autor;
  destinatario: Autor | null;
  texto: string;
  /** `id` = filename do ML (identificador); `nome` = nome de exibição. */
  anexos: Array<{ id: string; nome: string }>;
  status: string | null;
  moderacao: string | null;
}

export interface MotivoRevisao { id: string; texto: string; exige_foto: boolean; aplica: string[] }

export interface ReembolsoParcial { ofertas: Array<{ percentual: number; valor: number }>; minimo: number | null }

export interface Resolucao {
  papel: string; tipo: string; status: string;
  detalhes: Array<{ chave: string; valor: string }>;
  criada_em: string; atualizada_em: string;
}

export interface DetalheReclamacao {
  claim_id: number;
  return_id: number | null;
  stage: string | null;
  status: string | null;
  estado: {
    titulo: string | null; descricao: string | null; problema: string | null;
    prazo: string | null; vez_de: 'vendedor' | 'comprador' | 'ml' | null;
  };
  comprador_quer: string | null;
  resolucoes: Resolucao[];
  resolucao_final: { motivo: string | null; data: string | null } | null;
  afeta_reputacao: string | null;
  custo_devolucao: number | null;
  historico: MensagemHistorico[];
  acoes: string[];
  revisoes: RevisaoML[];
  pedidos_devolucao: number[];
  motivos_falha_revisao: MotivoRevisao[];
  reembolso_parcial: ReembolsoParcial | null;
  /** Leituras só informativas que falharam (campo correspondente vem null/vazio). */
  incompleto: string[];
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) ? n : null;
};

/** `mediator` = ML; o papel da conta (`respondent`/`complainant`...) = vendedor; o resto = comprador. */
export function autorDoPapel(role: string | null | undefined, papelDaConta: string | null | undefined): Autor {
  if (role === 'mediator') return 'ml';
  if (papelDaConta && role === papelDaConta) return 'vendedor';
  return 'comprador';
}

/** Lista de eventos: array direto ou envelope com um array dentro. */
function listaDe(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  const o = obj(v);
  const interno = o && Object.values(o).find(Array.isArray);
  return (interno as unknown[] | undefined) ?? [];
}

/** claims/{id}/messages + claims/{id}/status-history → linha do tempo cronológica.
 *  status-history é tratado defensivamente (formato não medido): `{stage,status,date|date_created}`. */
export function montarHistorico(
  mensagens: unknown, statusHistory: unknown, papelDaConta: string | null | undefined,
): MensagemHistorico[] {
  const out: MensagemHistorico[] = [];
  for (const raw of Array.isArray(mensagens) ? mensagens : []) {
    const m = obj(raw);
    if (!m) continue;
    const data = str(m.date_created) ?? str(m.message_date);
    if (!data) continue;
    const anexos = (Array.isArray(m.attachments) ? m.attachments : []).flatMap((a) => {
      const id = str(obj(a)?.filename) ?? str(obj(a)?.original_filename);
      return id ? [{ id, nome: str(obj(a)?.original_filename) ?? id }] : [];
    });
    const dest = str(m.receiver_role);
    out.push({
      data,
      autor: autorDoPapel(str(m.sender_role), papelDaConta),
      destinatario: dest ? autorDoPapel(dest, papelDaConta) : null,
      texto: str(m.message) ?? '',
      anexos,
      status: str(m.status),
      moderacao: str(obj(m.message_moderation)?.status),
    });
  }
  for (const raw of listaDe(statusHistory)) {
    const e = obj(raw);
    const data = str(e?.date) ?? str(e?.date_created) ?? str(e?.last_updated);
    const status = str(e?.status);
    const stage = str(e?.stage);
    if (!e || !data || !(status || stage)) continue;
    out.push({
      data, autor: 'ml', destinatario: null,
      texto: `Status da reclamação: ${[stage, status].filter(Boolean).join(' / ')}`,
      anexos: [], status, moderacao: null,
    });
  }
  return out.sort((a, b) => Date.parse(a.data) - Date.parse(b.data));
}

const EXIGE_FOTO = new Set(['SRF2', 'SRF4']);

/** GET returns/reasons?flow=seller_return_failed → motivos de revisão reprovada. `aplica` preserva `apply`. */
export function motivosRevisao(resp: unknown): MotivoRevisao[] {
  if (!Array.isArray(resp)) return [];
  const out: MotivoRevisao[] = [];
  for (const raw of resp) {
    const r = obj(raw);
    const id = str(r?.id);
    if (!r || !id) continue;
    out.push({
      id,
      texto: str(r.detail) ?? str(r.name) ?? id,
      exige_foto: EXIGE_FOTO.has(id),
      aplica: (Array.isArray(r.apply) ? r.apply : []).filter((x): x is string => typeof x === 'string'),
    });
  }
  return out;
}

/** GET partial-refund/available-offers → ofertas (sem 100%, que é reembolso total) e piso. */
export function ofertasReembolso(resp: unknown): ReembolsoParcial | null {
  const r = obj(resp);
  if (!r || !Array.isArray(r.available_offers)) return null;
  const ofertas: ReembolsoParcial['ofertas'] = [];
  for (const o of r.available_offers) {
    const percentual = num(obj(o)?.percentage);
    const valor = num(obj(o)?.amount);
    if (percentual != null && valor != null && percentual < 100) ofertas.push({ percentual, valor });
  }
  const min = (Array.isArray(r.restrictions) ? r.restrictions : []).map(obj).find((x) => x?.type === 'minimum');
  return { ofertas, minimo: num(min?.percentage) };
}

/** GET claims/{id}/expected-resolutions → resoluções esperadas (percentual da oferta fica em `detalhes`). */
export function mapearResolucoes(resp: unknown): Resolucao[] {
  if (!Array.isArray(resp)) return [];
  const out: Resolucao[] = [];
  for (const raw of resp) {
    const r = obj(raw);
    const tipo = str(r?.expected_resolution);
    if (!r || !tipo) continue;
    const detalhes = (Array.isArray(r.details) ? r.details : []).flatMap((d): Array<{ chave: string; valor: string }> => {
      const o = obj(d);
      if (!o) return [];
      if ('key' in o) return [{ chave: String(o.key), valor: String(o.value ?? '') }];
      return Object.entries(o).map(([chave, v]) => ({ chave, valor: String(v ?? '') }));
    });
    out.push({
      papel: str(r.player_role) ?? '', tipo, status: str(r.status) ?? '', detalhes,
      criada_em: str(r.date_created) ?? '', atualizada_em: str(r.last_updated) ?? '',
    });
  }
  return out;
}

// ─── Ações de escrita no ML (Task 5, ADR-0192) ───────────────────────────────────────────────

export type AcaoPosvenda =
  | 'revisar_ok' | 'revisar_falha' | 'responder' | 'reembolsar' | 'reembolso_parcial'
  | 'autorizar_devolucao' | 'abrir_disputa';

/** Ação do PubliAI → nomes de `available_actions` do player da conta que a liberam. */
export const ACAO_ML: Record<AcaoPosvenda, string[]> = {
  revisar_ok: ['return_review_ok'],
  revisar_falha: ['return_review_fail'],
  responder: ['send_message_to_complainant', 'send_message_to_mediator'],
  reembolsar: ['refund'],
  reembolso_parcial: ['allow_partial_refund'],
  autorizar_devolucao: ['allow_return', 'allow_return_label'],
  abrir_disputa: ['open_dispute'],
};

export const ehAcaoPosvenda = (v: unknown): v is AcaoPosvenda => typeof v === 'string' && Object.hasOwn(ACAO_ML, v);

export interface RevisaoFalhaItem { order_id?: number; motivo_id: string; texto: string; anexos: string[] }
/** Parte do body que define o que vai ao ML (o payload gravado e hasheado). */
export interface CorpoAcao { texto?: string; percentual?: number; revisoes?: RevisaoFalhaItem[]; anexos?: string[] }

const ehRevisao = (acao: AcaoPosvenda) => acao === 'revisar_ok' || acao === 'revisar_falha';

/** Em disputa (ou quando só o mediador pode receber) a resposta vai ao ML; senão, ao comprador. */
export function destinatarioResposta(acoes: string[], stage: string | null): 'complainant' | 'mediator' {
  if (stage === 'dispute') return 'mediator';
  if (acoes.includes('send_message_to_mediator') && !acoes.includes('send_message_to_complainant')) return 'mediator';
  return 'complainant';
}

/** Recurso da trava: revisões do mesmo return, resoluções do mesmo claim e mensagens do claim. */
export function chaveRecurso(acao: AcaoPosvenda, claimId: number | string, returnId: number | string | null): string {
  if (ehRevisao(acao)) return `return:${returnId}`;
  if (acao === 'responder') return `claim:${claimId}:msg`;
  return `claim:${claimId}:resolucao`;
}

/** O ML ainda aceita a ação? (liberada em `available_actions` ou, para revisão, algum pedido `pending`).
 *  `status='closed'` sozinho nunca conta: revisão segue aberta com o claim fechado. */
export function mlAceitaAinda(acao: AcaoPosvenda, d: DetalheReclamacao): boolean {
  if (ACAO_ML[acao].some((a) => d.acoes.includes(a))) return true;
  return ehRevisao(acao) && d.revisoes.some((r) => r.seller_status === 'pending');
}

export const MSG_ACAO_NAO_LIBERADA = 'Esta ação não está liberada pelo Mercado Livre agora. Recarregue a reclamação.';
export const MSG_REVISAO_FEITA = 'A revisão desta devolução já foi feita no Mercado Livre.';
export const MSG_REVISAO_NAO_LIBERADA = 'O ML ainda não liberou a revisão. Tente de novo mais tarde.';

/** Regra ÚNICA de elegibilidade da revisão (espelhada em src/lib/posvenda-fila.ts; teste de paridade lá).
 *  Mesma precedência de `revisaoPendente`: com revisões lidas, só `pending` conta (revisão terminal vence
 *  ação residual em `available_actions`); e o POST ainda exige a ação liberada pelo ML. null = elegível. */
export function motivoRevisaoIndisponivel(
  acao: 'revisar_ok' | 'revisar_falha', d: { acoes: string[]; revisoes: Array<{ seller_status: string | null }> },
): string | null {
  const liberada = ACAO_ML[acao].some((a) => d.acoes.includes(a));
  if (d.revisoes.length) {
    if (!d.revisoes.some((r) => r.seller_status === 'pending')) return MSG_REVISAO_FEITA;
    return liberada ? null : MSG_REVISAO_NAO_LIBERADA;
  }
  return liberada ? null : MSG_ACAO_NAO_LIBERADA;
}

/** null = pode enviar; string = motivo da recusa (nenhum POST acontece). */
export function validarAcao(acao: AcaoPosvenda, body: CorpoAcao, d: DetalheReclamacao): string | null {
  if (acao === 'revisar_ok' || acao === 'revisar_falha') {
    const m = motivoRevisaoIndisponivel(acao, d);
    if (m) return m;
  }
  const liberada = acao === 'responder'
    ? d.acoes.includes(`send_message_to_${destinatarioResposta(d.acoes, d.stage)}`)
    : ACAO_ML[acao].some((a) => d.acoes.includes(a));
  if (!liberada) return MSG_ACAO_NAO_LIBERADA;

  if (acao === 'revisar_falha') {
    const itens = body.revisoes ?? [];
    if (!itens.length) return 'Escolha ao menos um motivo.';
    const carrinho = d.pedidos_devolucao.length > 1;
    for (const r of itens) {
      const m = d.motivos_falha_revisao.find((x) => x.id === r.motivo_id);
      if (!m) return 'Motivo de revisão inválido. Recarregue a reclamação.';
      if (r.order_id != null) {
        if (!d.pedidos_devolucao.includes(r.order_id) || !m.aplica.includes('order')) {
          return 'Motivo ou pedido inválido para esta devolução.';
        }
      } else if (!(m.aplica.includes('package') || (!carrinho && m.aplica.includes('order')))) {
        return 'Este motivo não vale para o pacote inteiro; escolha o pedido.';
      }
      if (!r.texto?.trim()) return 'Escreva a descrição do problema.';
      if (m.exige_foto && !(r.anexos?.length)) return `O motivo "${m.texto}" exige ao menos uma foto.`;
    }
  }
  if (acao === 'responder') {
    const n = body.texto?.trim().length ?? 0;
    if (n < 1 || n > 2000) return 'A mensagem precisa ter de 1 a 2000 caracteres.';
  }
  if (acao === 'reembolso_parcial') {
    const ofertas = d.reembolso_parcial?.ofertas.map((o) => o.percentual) ?? [];
    if (body.percentual == null || !ofertas.includes(body.percentual)) return 'Percentual de reembolso não oferecido pelo ML.';
  }
  return null;
}

/** Path (a partir de api.mercadolibre.com) e corpo do POST. */
export function montarRequisicao(
  acao: AcaoPosvenda, claimId: number | string, returnId: number | string | null, body: CorpoAcao,
  receiverRole: 'complainant' | 'mediator',
): { path: string; corpo: unknown } {
  const v1 = '/post-purchase/v1';
  const claim = `${v1}/claims/${claimId}`;
  switch (acao) {
    case 'revisar_ok': return { path: `${v1}/returns/${returnId}/return-review`, corpo: {} };
    case 'revisar_falha': return {
      path: `${v1}/returns/${returnId}/return-review`,
      corpo: (body.revisoes ?? []).map((r) => ({
        reason: r.motivo_id, message: r.texto, attachments: r.anexos, ...(r.order_id ? { order_id: r.order_id } : {}),
      })),
    };
    case 'responder': return {
      path: `${claim}/actions/send-message`,
      corpo: { receiver_role: receiverRole, message: (body.texto ?? '').trim(), attachments: body.anexos ?? [] },
    };
    case 'reembolsar': return { path: `${claim}/expected-resolutions/refund`, corpo: {} };
    case 'reembolso_parcial': return { path: `${claim}/expected-resolutions/partial-refund`, corpo: { percentage: body.percentual } };
    case 'autorizar_devolucao': return { path: `${claim}/expected-resolutions/allow-return`, corpo: {} };
    case 'abrir_disputa': return { path: `${claim}/actions/open-dispute`, corpo: {} };
  }
}

export type Efeito = 'confirmado' | 'nao' | 'inconclusivo';
export interface TentativaEfeito { payload: CorpoAcao; post_em: string; http_status: number | null }

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const RESOLUCAO_ACEITA = new Set(['accepted', 'applied']);
const mesmaResolucao = (a: Resolucao, b: Resolucao) => a.papel === b.papel && a.tipo === b.tipo && a.criada_em === b.criada_em;

/** Evidência POSITIVA e específica de que o efeito da NOSSA tentativa está no ML.
 *  Ausência de evidência nunca é confirmação; quem decide liberar a trava é `mlAceitaAinda`. */
export function efeitoConfirmado(
  acao: AcaoPosvenda, antes: DetalheReclamacao, depois: DetalheReclamacao, t: TentativaEfeito,
): Efeito {
  const post = ms(t.post_em);
  const ok2xx = t.http_status != null && t.http_status >= 200 && t.http_status < 300;
  const novas = depois.resolucoes.filter((r) => ms(r.criada_em) >= post && !antes.resolucoes.some((a) => mesmaResolucao(a, r)));

  if (acao === 'responder') {
    const dest = destinatarioResposta(antes.acoes, antes.stage) === 'mediator' ? 'ml' : 'comprador';
    const texto = (t.payload.texto ?? '').trim();
    const anexos = [...(t.payload.anexos ?? [])].sort().join('|');
    const casa = (m: MensagemHistorico) => m.autor === 'vendedor' && m.destinatario === dest && m.texto.trim() === texto
      && m.anexos.map((a) => a.id).sort().join('|') === anexos && ms(m.data) >= post;
    const nAntes = antes.historico.filter(casa).length;
    const achadas = depois.historico.filter(casa);
    if (achadas.length <= nAntes) return 'inconclusivo';
    const nova = achadas[achadas.length - 1];
    if (nova.moderacao === 'clean') return 'confirmado';
    if (nova.moderacao === 'rejected') return 'nao';
    return 'inconclusivo';
  }
  if (ehRevisao(acao)) {
    const pendentesAntes = antes.revisoes.filter((r) => r.seller_status === 'pending').map((r) => r.order_id);
    const itens = t.payload.revisoes ?? [];
    const alvo = acao === 'revisar_falha' && itens.length && itens.every((r) => r.order_id != null)
      ? itens.map((r) => r.order_id!).filter((o) => pendentesAntes.includes(o))
      : pendentesAntes;
    if (!alvo.length) return 'nao';
    const st = alvo.map((o) => depois.revisoes.find((r) => r.order_id === o)?.seller_status ?? null);
    // `success` também é "não revisou a tempo": só vale como OK com 2xx da nossa tentativa.
    if (st.every((s) => s === 'success')) {
      if (!ok2xx) return 'inconclusivo';
      return acao === 'revisar_ok' ? 'confirmado' : 'nao';
    }
    // `claimed`/`failed` só o vendedor produz.
    if (acao === 'revisar_falha' && st.every((s) => s === 'claimed' || s === 'failed')) return 'confirmado';
    return 'nao';
  }
  if (acao === 'reembolsar') {
    if (novas.some((r) => r.papel === 'respondent' && r.tipo === 'refund' && RESOLUCAO_ACEITA.has(r.status))) return 'confirmado';
    const f = depois.resolucao_final;
    const motivo = f?.motivo ?? '';
    if (depois.status === 'closed' && /refund/i.test(motivo) && !/partial/i.test(motivo) && ms(f?.data) >= post) return 'confirmado';
    return 'nao';
  }
  if (acao === 'reembolso_parcial') {
    const ofertas = novas.filter((r) => r.papel === 'respondent' && r.tipo === 'partial_refund');
    const pct = (r: Resolucao) => Number(r.detalhes.find((x) => x.chave === 'percentage')?.valor);
    return ofertas.some((r) => pct(r) === t.payload.percentual) ? 'confirmado' : 'nao';
  }
  if (acao === 'autorizar_devolucao') return antes.return_id == null && depois.return_id != null ? 'confirmado' : 'nao';
  return antes.stage === 'claim' && depois.stage === 'dispute' ? 'confirmado' : 'nao';
}

// --- Anexos (Task 6) ---
export type DestinoAnexo = 'revisao' | 'mensagem';
const TIPOS_ANEXO: Record<DestinoAnexo, string[]> = {
  revisao: ['image/jpeg', 'image/png'],
  mensagem: ['image/jpeg', 'image/png', 'application/pdf'],
};
export const MAX_BYTES_ANEXO = 5 * 1024 * 1024;

/** Valida tipo e tamanho no servidor antes de chamar o ML. null = ok. */
export function validarArquivoAnexo(tipo: string, bytes: number, destino: DestinoAnexo): string | null {
  if (!TIPOS_ANEXO[destino].includes(tipo)) {
    return destino === 'revisao' ? 'Formato não aceito: use JPG ou PNG.' : 'Formato não aceito: use JPG, PNG ou PDF.';
  }
  if (bytes <= 0) return 'Arquivo vazio.';
  if (bytes > MAX_BYTES_ANEXO) return 'Arquivo acima de 5 MB.';
  return null;
}

/** Identificador do anexo na resposta do ML (`file_name` na revisão, `filename` na mensagem). */
export function nomeDoAnexo(resp: unknown, destino: DestinoAnexo): string | null {
  const v = (resp as Record<string, unknown> | null)?.[destino === 'revisao' ? 'file_name' : 'filename'];
  return typeof v === 'string' && v ? v : null;
}
