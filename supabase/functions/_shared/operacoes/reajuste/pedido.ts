// I5 — leitura dos pedidos do usuário (preview/confirmar) e tradução do resultado de `reajuste_confirmar`.
// Puro (vitest). Fronteira de confiança: tudo que vai para `.in()`/RPC sai daqui validado.
import { MAX_MLBS, type ItemPreview, type PedidoPreview } from './preview.ts';

export interface Confirmacao { ml_item_id: string; risco: boolean; sem_dado: boolean; incluir?: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x);
const textos = (x: unknown, ok: (s: string) => boolean): string[] | null =>
  x == null ? [] : Array.isArray(x) && x.length <= MAX_MLBS && x.every((s) => typeof s === 'string' && ok(s)) ? [...new Set(x as string[])] : null;
const numero = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function lerPreview(x: unknown): PedidoPreview | null {
  const b = x as Record<string, unknown> | null;
  if (!b || b.acao !== 'reajustar') return null;
  const familias = textos(b.familias, (s) => UUID.test(s));
  const ml_item_ids = textos(b.ml_item_ids, (s) => s.length > 0 && s.length <= 40);
  if (!familias || !ml_item_ids) return null;
  if (b.origem_id != null && !ehUuid(b.origem_id)) return null;
  const origem_id = (b.origem_id as string | null | undefined) ?? null;

  let ajuste: PedidoPreview['ajuste'] = null;
  if (b.ajuste != null) {
    const a = b.ajuste as Record<string, unknown>;
    if ((a.tipo !== 'pct' && a.tipo !== 'reais') || (a.sentido !== '+' && a.sentido !== '-') || !numero(a.valor)) return null;
    ajuste = { tipo: a.tipo, sentido: a.sentido, valor: a.valor };
  }
  let precos: Record<string, number> | undefined;
  if (b.precos != null) {
    if (typeof b.precos !== 'object' || Array.isArray(b.precos)) return null;
    const ps = Object.entries(b.precos as Record<string, unknown>);
    if (ps.length > MAX_MLBS || !ps.every(([, v]) => numero(v))) return null;
    precos = Object.fromEntries(ps) as Record<string, number>;
  }
  if (!origem_id && !familias.length && !ml_item_ids.length) return null;
  return { familias, ml_item_ids, ajuste, ...(precos ? { precos } : {}), origem_id };
}

export function lerConfirmar(x: unknown): { operacao_id: string; confirmacoes: Confirmacao[] } | null {
  const b = x as Record<string, unknown> | null;
  if (!b || !ehUuid(b.operacao_id) || !Array.isArray(b.confirmacoes) || b.confirmacoes.length > MAX_MLBS) return null;
  const confirmacoes: Confirmacao[] = [];
  for (const c of b.confirmacoes as Record<string, unknown>[]) {
    if (!c || typeof c.ml_item_id !== 'string' || !c.ml_item_id) return null;
    if ([c.risco, c.sem_dado, c.incluir].some((v) => v != null && typeof v !== 'boolean')) return null;
    confirmacoes.push({
      ml_item_id: c.ml_item_id, risco: c.risco === true, sem_dado: c.sem_dado === true,
      ...(typeof c.incluir === 'boolean' ? { incluir: c.incluir } : {}),
    });
  }
  return { operacao_id: b.operacao_id, confirmacoes };
}

export const MSG_EXPIRADO = 'O preview expirou — gere de novo';
export const MSG_CONFIRMAR_RISCO = 'Confirme o risco deste anúncio';
export const MSG_OCUPADO = 'Algum destes anúncios já está numa operação em andamento.';
const MSG_SEM_PRODUTO = 'Anúncio não encontrado nesta organização';

/** Retorno de `reajuste_confirmar` ou mensagem do P0001 que ela levanta → publicar, ou a resposta de erro. */
export function respostaConfirmar(r: string):
  | { publicar: true }
  | { publicar: false; status: 400 | 409; corpo: { erro: string; itens?: { ml_item_id: string; motivo: string }[] } } {
  if (r === 'ok' || r === 'ja_confirmada') return { publicar: true };
  const item = (prefixo: string) => (r.startsWith(prefixo) ? r.slice(prefixo.length) : null);
  let ml: string | null;
  if ((ml = item('confirmacao_faltando:')) !== null) {
    return { publicar: false, status: 400, corpo: { erro: MSG_CONFIRMAR_RISCO, itens: [{ ml_item_id: ml, motivo: MSG_CONFIRMAR_RISCO }] } };
  }
  if ((ml = item('ocupado:')) !== null) {
    return { publicar: false, status: 409, corpo: { erro: MSG_OCUPADO, itens: [{ ml_item_id: ml, motivo: MSG_OCUPADO }] } };
  }
  if ((ml = item('sem_produto:')) !== null) {
    return { publicar: false, status: 400, corpo: { erro: MSG_SEM_PRODUTO, itens: [{ ml_item_id: ml, motivo: MSG_SEM_PRODUTO }] } };
  }
  if (r === 'expirado') return { publicar: false, status: 400, corpo: { erro: MSG_EXPIRADO } };
  return { publicar: false, status: 400, corpo: { erro: 'Nada a executar neste preview — gere de novo.' } };
}

export const lerRetomar = (x: unknown): { operacao_id: string } | null => {
  const b = x as Record<string, unknown> | null;
  return b && ehUuid(b.operacao_id) ? { operacao_id: b.operacao_id } : null;
};

/** Retomar (C3): só reajuste `executando` da org (null = não achou nesta org). */
export function decidirRetomar(op: { acao: string; status: string } | null):
  | { ok: true } | { ok: false; status: 400 | 404; erro: string } {
  if (!op) return { ok: false, status: 404, erro: 'Operação não encontrada.' };
  if (op.acao !== 'reajustar' || op.status !== 'executando') {
    return { ok: false, status: 400, erro: 'Só um reajuste em execução pode ser retomado.' };
  }
  return { ok: true };
}

/** Id novo por minuto: o `executar_<op>_0` estável engoliria a retomada; 2 cliques no mesmo minuto viram 1. */
export const idRetomada = (operacaoId: string, agoraMs: number) => `retomar_${operacaoId}_${Math.floor(agoraMs / 60_000)}`;

const STATUS_RASCUNHO ={ elegivel: 'rascunho', fora: 'bloqueado', sem_alteracao: 'ja_estava' } as const;

/** Linhas do rascunho (sem operacao_id/org_id). `estado_anterior` = `restaurar` (formato único, lido pelo executor). */
export function linhasDoRascunho(itens: ItemPreview[]) {
  return itens.map((i) => ({
    promocao_id: null, ml_item_id: i.ml_item_id, titulo: i.titulo, status: STATUS_RASCUNHO[i.situacao],
    // 0 = preço não lido (item fora): nulo no banco.
    preco: i.preco || null, preco_anterior: i.preco_anterior || null, mensagem: i.motivo ?? i.aviso,
    semaforo: i.avaliacao?.pior ?? null, confirmado_risco: false, incluido: i.incluido, avaliacao: i.avaliacao,
    estado_anterior: i.restaurar, variacoes_ml: i.variacoes_ml, variacao_ids: i.variacao_ids, codigo_pai: i.codigo_pai || null,
  }));
}
