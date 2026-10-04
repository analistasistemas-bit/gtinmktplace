// Multiget de anúncios do ML via `/items/bulk` (`/items?ids=` sai do ar em 25/10/2026, ADR-0177).
// ADAPTADOR, não parser: entrega a resposta no envelope antigo `[{code, body}]` para que nenhum
// módulo mude predicado, laço ou tratamento de erro. Contrato medido em 03/10/2026 (spec §2):
// - seleção com `status_code` + `body.<campo>`; id repetido → 400 (o antigo deduplicava antes do limite);
// - id inexistente → `{status_code:404}` SEM body, na posição do id pedido.

const unicos = (ids: readonly string[]): string[] => [...new Set(ids)];

/** Caminho relativo do bulk. Dedup só dentro da requisição; não divide, não filtra, não lança. */
export function caminhoMultiget(ids: readonly string[], campos: string, extra = ''): string {
  const sel = campos.split(',').map((c) => `body.${c}`).join(',');
  return `/items/bulk?ids=${unicos(ids).map(encodeURIComponent).join(',')}&attributes=status_code,${sel}${extra}`;
}

type Obj = Record<string, unknown>;
const ehObj = (e: unknown): e is Obj => !!e && typeof e === 'object' && !Array.isArray(e);
const idDe = (e: Obj): unknown => (ehObj(e.body) ? e.body.id : undefined);

/**
 * Resposta do bulk → envelope antigo. Regras:
 * - não-array volta intacto; entrada não-objeto ou já no formato antigo (tem `code`) volta intacta;
 * - entrada bulk vira `{code: status_code, body?}`;
 * - SÓ o 404 sem body ganha `body: {id}`, pela posição, e só se a cardinalidade bate com os ids
 *   únicos enviados E todo id presente está na sua posição. 200/500 sem body nunca ganham body.
 */
export function comoEnvelopeAntigo(json: unknown, idsPedidos: readonly string[]): unknown {
  if (!Array.isArray(json)) return json;
  const enviados = unicos(idsPedidos);
  const alinhado = json.length === enviados.length && json.every((e, i) => {
    if (!ehObj(e)) return false;
    const id = idDe(e);
    return id === undefined || id === enviados[i];
  });
  return json.map((e, i) => {
    if (!ehObj(e) || 'code' in e) return e;
    const out: Obj = { code: e.status_code };
    if ('body' in e) out.body = e.body;
    else if (alinhado && e.status_code === 404) out.body = { id: enviados[i] };
    return out;
  });
}
