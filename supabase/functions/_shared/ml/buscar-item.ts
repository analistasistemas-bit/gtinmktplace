// ADR-0088 — busca de item por SKU (seller_custom_field) para adoção de órfão sem ID.
// A saga UP marca a linha `criacao_incerta` antes do POST; se cair no meio, um item pode
// ter sido criado no ML sem o id persistido localmente. Antes de recriar, procura por ele.
//
// Endpoint privado: GET /users/{seller_id}/items/search?sku=<seller_custom_field>.
// `sku` é o ÚNICO filtro server-side garantido pela doc oficial — category_id combinado NÃO
// é demonstrado e NÃO é assumido. Os demais critérios (category_id, family_name exato, seller,
// janela de recência) são validados via multiget dos IDs retornados, nunca presumidos filtrados.

/** fetch-like injetável (testável sem rede; produção passa o `fetch` global). */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type BuscaSku =
  | { tipo: 'nenhum' }
  | { tipo: 'um'; itemExternoId: string }
  | { tipo: 'ambiguo' }    // >1 match após validação → bloqueia adoção
  | { tipo: 'truncado' };  // paging.total maior do que conseguimos cobrir → bloqueia adoção

export interface CriteriosBuscaSku {
  accessToken: string;
  sellerId: string;
  categoriaId: string;
  familyName: string;
  desdeMs: number; // date_created >= este instante (janela de recência)
}

const LIMITE_PAGINA = 100;
const MAX_PAGINAS = 10; // teto de segurança: um SKU legítimo casa ≤1 item; além disso é suspeito → truncado
const MULTIGET_CHUNK = 20;

const API = 'https://api.mercadolibre.com';

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

interface ItemMultiget {
  id: string;
  category_id: string;
  family_name: string | null;
  seller_id: string | number;
  date_created: string;
}

export async function buscarItemPorSku(
  fetchLike: FetchLike,
  crit: CriteriosBuscaSku,
  sku: string,
): Promise<BuscaSku> {
  const headers = { Authorization: `Bearer ${crit.accessToken}` };

  // 1. Paginação real: coleta os ids de todas as páginas (offset/total), com teto de páginas.
  const ids: string[] = [];
  let total = 0;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const offset = pagina * LIMITE_PAGINA;
    const url = `${API}/users/${crit.sellerId}/items/search`
      + `?sku=${encodeURIComponent(sku)}&limit=${LIMITE_PAGINA}&offset=${offset}`;
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`busca por SKU (${resp.status})`);
    const json = (await resp.json()) as { results?: string[]; paging?: { total?: number } };
    const results = json.results ?? [];
    total = json.paging?.total ?? results.length;
    ids.push(...results);
    if (ids.length >= total || results.length === 0) break;
  }
  if (total === 0) return { tipo: 'nenhum' };
  // Não cobrimos tudo (mais itens do que o teto alcança) → truncado, nunca assumir completo.
  if (ids.length < total) return { tipo: 'truncado' };

  // 2. Multiget dos ids retornados e validação local (category_id, family_name exato, seller, recência).
  const validos: string[] = [];
  for (const bloco of chunk(ids, MULTIGET_CHUNK)) {
    const url = `${API}/items?ids=${bloco.join(',')}`
      + `&attributes=id,category_id,family_name,seller_id,date_created`;
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`multiget de adoção (${resp.status})`);
    const arr = (await resp.json()) as Array<{ code?: number; body?: ItemMultiget }>;
    for (const entry of Array.isArray(arr) ? arr : []) {
      if (entry?.code !== 200 || !entry.body) continue;
      const b = entry.body;
      if (b.category_id !== crit.categoriaId) continue;
      if (b.family_name !== crit.familyName) continue;
      if (String(b.seller_id) !== crit.sellerId) continue;
      if (!(Date.parse(b.date_created) >= crit.desdeMs)) continue;
      validos.push(b.id);
    }
  }

  if (validos.length === 0) return { tipo: 'nenhum' };
  if (validos.length > 1) return { tipo: 'ambiguo' };
  return { tipo: 'um', itemExternoId: validos[0] };
}

/** Campos de confirmação de um item UP (GET direto). `buscarItemML` NÃO os traz
 *  (só id/variations/pictures/price), por isso a saga usa este GET dedicado. */
export interface ItemUP {
  status: string | null;
  familyId?: string;
  userProductId?: string;
  permalink?: string;
  sellerId?: string;
}

/** GET /items/{id} pedindo os atributos que a saga confirma (family_id/user_product_id/
 *  seller_id/permalink/status). `null` se o GET falhar (404/erro) — a porta trata como
 *  estado remoto inesperado. seller_id é normalizado com String() (o ML pode devolver número). */
export async function buscarItemUP(
  fetchLike: FetchLike,
  crit: { accessToken: string },
  itemId: string,
): Promise<ItemUP | null> {
  const url = `${API}/items/${encodeURIComponent(itemId)}`
    + `?attributes=id,family_id,user_product_id,seller_id,permalink,status`;
  const resp = await fetchLike(url, { headers: { Authorization: `Bearer ${crit.accessToken}` } });
  if (!resp.ok) return null;
  const j = (await resp.json()) as {
    status?: string; family_id?: string; user_product_id?: string; permalink?: string; seller_id?: string | number;
  };
  return {
    status: j.status ?? null,
    familyId: j.family_id != null ? String(j.family_id) : undefined,
    userProductId: j.user_product_id != null ? String(j.user_product_id) : undefined,
    permalink: j.permalink,
    sellerId: j.seller_id != null ? String(j.seller_id) : undefined,
  };
}
