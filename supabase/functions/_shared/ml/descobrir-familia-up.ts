// ADR-0105 — descoberta da família User Products que substituiu um anúncio Legacy DISSOLVIDO.
//
// O ML não converte o item: ele fecha o anúncio Legacy (`status: closed`, `sub_status: []`) e cria
// N itens novos sob um `family_id`. O item morto NÃO guarda family_id, family_name, user_product_id
// nem parent_item_id — não há um único ponteiro do velho para o novo (apurado no lote #45).
//
// Sobram duas âncoras, ambas verificadas contra a API real:
//   - `?q=<título>` devolve o item morto + os irmãos (é como a família é localizada);
//   - `?family_id=<id>` devolve o conjunto COMPLETO e autoritativo dos irmãos.
// (`?family_name=` é aceito e SILENCIOSAMENTE IGNORADO pela API — devolve todos os itens do
// vendedor. Nunca usar como filtro.)
//
// A identidade de cada cor é `COLOR.value_name`, comparada entre dados AUTORAIS DO ML dos dois
// lados (variação do item morto × irmão). Nunca contra `variacoes.cor` do nosso banco — ver
// ADR-0105 §2.

import type { FetchLike } from './buscar-item.ts';

const API = 'https://api.mercadolibre.com';
const LIMITE_PAGINA = 100;
const MAX_PAGINAS = 5;   // teto de segurança: uma família dissolvida cabe folgada aqui
const MULTIGET_CHUNK = 20;

/** Status remotos que um irmão vivo pode ter. Qualquer outro não entra na descoberta. */
const STATUS_VIVO = new Set(['active', 'paused']);

export interface IrmaoCandidato {
  id: string;
  familyId: string;
  familyName: string | null;
  cor: string | null;
  status: string | null;
}

export interface FamiliaUPDescoberta {
  familyId: string;
  familyName: string;
  /** COLOR.value_name → id do item irmão. Só cores com EXATAMENTE um irmão vivo. */
  itemPorCor: Map<string, string>;
  /** Cores com mais de um irmão vivo — nunca viram vínculo (escolher seria adivinhar). */
  coresAmbiguas: string[];
}

export type ResultadoDescoberta =
  | { tipo: 'achada'; familia: FamiliaUPDescoberta }
  | { tipo: 'nenhuma' }
  | { tipo: 'ambigua'; familyIds: string[] }
  // Não cobrimos toda a paginação: o conjunto observado NÃO é o conjunto real. Um `?q=` truncado
  // pode esconder um segundo family_id e transformar o que deveria ser `ambigua` num `achada`
  // confiante e errado; um `?family_id=` truncado esconde irmãos. Nunca seguir — mesma razão do
  // `{tipo:'truncado'}` de `buscarItemPorSku`.
  | { tipo: 'truncada'; observados: number; total: number };

export interface CriteriosDescoberta {
  /** Lazy de propósito: o token só é resolvido se a descoberta realmente rodar. */
  getToken(): Promise<string>;
  sellerId: string;
  /** Título do item morto — âncora da busca. */
  titulo: string;
  /** Categoria do item morto — filtro dos candidatos. */
  categoriaId: string;
  /** Id do item morto, para excluí-lo dos candidatos. */
  itemMortoId: string;
}

interface ItemBruto {
  id: string;
  seller_id?: string | number;
  category_id?: string;
  family_id?: string | number | null;
  family_name?: string | null;
  status?: string | null;
  variations?: unknown[];
  attributes?: Array<{ id?: string; value_name?: string | null }>;
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** COLOR.value_name dos `attributes` da raiz do item (irmão UP não tem variations). */
export function corDoItemUP(attributes: ItemBruto['attributes']): string | null {
  for (const a of attributes ?? []) {
    if (a?.id === 'COLOR') {
      const nome = a.value_name;
      return nome != null && nome !== '' ? nome : null;
    }
  }
  return null;
}

/**
 * Pagina `GET /users/{seller}/items/search`. `query` já traz o path do seller E a query string com
 * o `?` (ex.: `1003820507/items/search?q=...`) porque o filtro varia entre as duas chamadas — o
 * `&limit=/&offset=` daqui é apenso a ele.
 *
 * Devolve `truncado` quando não cobrimos `paging.total`: o chamador NUNCA pode tratar um conjunto
 * parcial como completo.
 */
async function paginarBusca(
  fetchLike: FetchLike,
  headers: Record<string, string>,
  query: string,
): Promise<{ ids: string[]; total: number; truncado: boolean }> {
  const ids: string[] = [];
  let total = 0;
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const url = `${API}/users/${query}&limit=${LIMITE_PAGINA}&offset=${pagina * LIMITE_PAGINA}`;
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`busca de família migrada (${resp.status})`);
    const json = (await resp.json()) as { results?: string[]; paging?: { total?: number } };
    const results = json.results ?? [];
    total = json.paging?.total ?? results.length;
    ids.push(...results);
    if (ids.length >= total || results.length === 0) break;
  }
  return { ids, total, truncado: ids.length < total };
}

async function multiget(
  fetchLike: FetchLike,
  headers: Record<string, string>,
  ids: string[],
): Promise<ItemBruto[]> {
  const out: ItemBruto[] = [];
  for (const bloco of chunk(ids, MULTIGET_CHUNK)) {
    const url = `${API}/items?ids=${bloco.join(',')}`
      + '&attributes=id,seller_id,category_id,family_id,family_name,status,variations,attributes';
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`multiget de família migrada (${resp.status})`);
    const arr = (await resp.json()) as Array<{ code?: number; body?: ItemBruto }>;
    for (const entry of Array.isArray(arr) ? arr : []) {
      if (entry?.code === 200 && entry.body?.id) out.push(entry.body);
    }
  }
  return out;
}

/**
 * Descobre a família User Products que substituiu `itemMortoId`.
 *
 * Passo 1 localiza a família (`?q=`), passo 2 a enumera pela fonte autoritativa (`?family_id=`) —
 * o segundo passo existe porque a busca por título não devolve necessariamente todos os irmãos.
 *
 * Fail-closed em toda validação: candidato de outro vendedor, de outra categoria, com `variations`
 * (= Legacy, não é irmão UP), sem `family_id`, ou em status desconhecido, é descartado. Mais de um
 * `family_id` entre os candidatos aborta com os ids observados — nunca escolhe.
 */
export async function descobrirFamiliaUP(
  fetchLike: FetchLike,
  crit: CriteriosDescoberta,
): Promise<ResultadoDescoberta> {
  const headers = { Authorization: `Bearer ${await crit.getToken()}` };

  const porTitulo = await paginarBusca(
    fetchLike,
    headers,
    `${encodeURIComponent(crit.sellerId)}/items/search?q=${encodeURIComponent(crit.titulo)}`,
  );
  if (porTitulo.truncado) {
    return { tipo: 'truncada', observados: porTitulo.ids.length, total: porTitulo.total };
  }
  if (porTitulo.ids.length === 0) return { tipo: 'nenhuma' };

  const candidatos = (await multiget(fetchLike, headers, porTitulo.ids)).filter((b) =>
    b.id !== crit.itemMortoId
    && b.seller_id != null && String(b.seller_id) === crit.sellerId
    && b.category_id === crit.categoriaId
    && b.family_id != null
    && !(Array.isArray(b.variations) && b.variations.length > 0)
    && STATUS_VIVO.has(b.status ?? '')
  );
  const familyIds = [...new Set(candidatos.map((b) => String(b.family_id)))];
  if (familyIds.length === 0) return { tipo: 'nenhuma' };
  if (familyIds.length > 1) return { tipo: 'ambigua', familyIds };
  const [familyId] = familyIds;

  // Fonte autoritativa: a busca por título pode ter deixado irmãos de fora.
  const daFamilia = await paginarBusca(
    fetchLike,
    headers,
    `${encodeURIComponent(crit.sellerId)}/items/search?family_id=${encodeURIComponent(familyId)}`,
  );
  if (daFamilia.truncado) {
    return { tipo: 'truncada', observados: daFamilia.ids.length, total: daFamilia.total };
  }
  const irmaos = (await multiget(fetchLike, headers, daFamilia.ids)).filter((b) =>
    b.id !== crit.itemMortoId
    && b.seller_id != null && String(b.seller_id) === crit.sellerId
    && String(b.family_id) === familyId
    && !(Array.isArray(b.variations) && b.variations.length > 0)
    && STATUS_VIVO.has(b.status ?? '')
  );

  const porCor = new Map<string, string[]>();
  let familyName: string | null = null;
  for (const b of irmaos) {
    if (familyName == null && b.family_name) familyName = b.family_name;
    const cor = corDoItemUP(b.attributes);
    if (!cor) continue;
    porCor.set(cor, [...(porCor.get(cor) ?? []), b.id]);
  }
  // Sem family_name não há `titulo` para a raiz `anuncios_externos` (ADR-0104 §3 exige) — e um
  // conjunto de irmãos sem nenhum family_name não é uma família UP reconhecível.
  if (!familyName || porCor.size === 0) return { tipo: 'nenhuma' };

  const itemPorCor = new Map<string, string>();
  const coresAmbiguas: string[] = [];
  for (const [cor, ids] of porCor) {
    if (ids.length === 1) itemPorCor.set(cor, ids[0]);
    else coresAmbiguas.push(cor);
  }

  return { tipo: 'achada', familia: { familyId, familyName, itemPorCor, coresAmbiguas } };
}
