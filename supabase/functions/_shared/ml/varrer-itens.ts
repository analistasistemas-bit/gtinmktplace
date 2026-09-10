// Varredura dos anúncios da conta no ML, para confrontar com o que o PubliAI conhece
// (incidente 2026-09-10, adendo do ADR-0088: anúncio criado pelo app e apagado do banco continuou
// vendendo sem que nada no sistema soubesse).
//
// Só leitura. Nunca escreve no ML.
const API = 'https://api.mercadolibre.com';
const LIMITE_PAGINA = 100;
// O `offset` do search para de funcionar em 1000 (limite do ML). Ir além exige `search_type=scan`,
// que troca offset por `scroll_id` — não vale a complexidade enquanto nenhuma conta real passar
// disso: o retorno diz `truncado` e a tela avisa que a varredura foi parcial.
const MAX_ITENS = 1000;
const MULTIGET_CHUNK = 20;

export type FetchLike = typeof fetch;

export interface ItemDoSeller {
  id: string;
  titulo: string | null;
  status: string | null;
  permalink: string | null;
  estoque: number | null;
  /** `seller_custom_field` — o código do PubliAI, quando o anúncio saiu daqui. */
  sku: string | null;
  /** `catalog_listing` do ML: o anúncio compete na ficha de catálogo. */
  catalogo: boolean;
}

/**
 * Classificação do que a varredura encontrou. Sem isto o resultado é uma lista crua onde o caso
 * acionável (anúncio que saiu do app e perdeu o vínculo) se perde entre centenas de anúncios que
 * nunca foram do PubliAI — 307 na conta de um cliente, medido em 2026-09-10.
 */
export type ClasseOrfao =
  /** SKU no formato do app: nasceu aqui e o vínculo se perdeu. É o caso do incidente. */
  | 'perdido_do_app'
  /** Anúncio de catálogo cujo vínculo não foi salvo no banco (opt-in não idempotente). */
  | 'catalogo_sem_vinculo'
  /** Nunca foi do PubliAI (ERP antigo, publicação manual). Informativo, não é pendência. */
  | 'externo';

const RE_CODIGO_APP = /^\d{8}$/;

export function classificar(item: ItemDoSeller): ClasseOrfao {
  const doApp = !!item.sku && RE_CODIGO_APP.test(item.sku.trim());
  if (!doApp) return 'externo';
  return item.catalogo ? 'catalogo_sem_vinculo' : 'perdido_do_app';
}

/** Ids dos anúncios do seller num status. `truncado` = a conta tem mais do que conseguimos ler. */
export async function listarIdsDoSeller(
  fetchLike: FetchLike,
  token: string,
  sellerId: string,
  status: 'active' | 'paused',
): Promise<{ ids: string[]; truncado: boolean }> {
  const headers = { Authorization: `Bearer ${token}` };
  const ids: string[] = [];
  let total = 0;
  for (let offset = 0; offset < MAX_ITENS; offset += LIMITE_PAGINA) {
    const url = `${API}/users/${encodeURIComponent(sellerId)}/items/search`
      + `?status=${status}&limit=${LIMITE_PAGINA}&offset=${offset}`;
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`varredura de anúncios (${status}): ML respondeu ${resp.status}`);
    const json = (await resp.json()) as { results?: string[]; paging?: { total?: number } };
    const results = json.results ?? [];
    total = json.paging?.total ?? results.length;
    ids.push(...results);
    if (ids.length >= total || results.length === 0) break;
  }
  return { ids, truncado: ids.length < total };
}

/** Detalhes dos anúncios em blocos (multiget). Item que o ML não devolve com 200 é ignorado. */
export async function detalharItens(
  fetchLike: FetchLike,
  token: string,
  ids: string[],
): Promise<ItemDoSeller[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const out: ItemDoSeller[] = [];
  for (let i = 0; i < ids.length; i += MULTIGET_CHUNK) {
    const bloco = ids.slice(i, i + MULTIGET_CHUNK);
    const url = `${API}/items?ids=${bloco.join(',')}`
      + '&attributes=id,title,status,permalink,available_quantity,seller_custom_field,catalog_listing';
    const resp = await fetchLike(url, { headers });
    if (!resp.ok) throw new Error(`detalhes dos anúncios: ML respondeu ${resp.status}`);
    const arr = (await resp.json()) as Array<{
      code?: number;
      body?: {
        id?: string; title?: string; status?: string; permalink?: string;
        available_quantity?: number; seller_custom_field?: string | null;
        catalog_listing?: boolean;
      };
    }>;
    for (const entry of Array.isArray(arr) ? arr : []) {
      const b = entry?.body;
      if (entry?.code !== 200 || !b?.id) continue;
      out.push({
        id: b.id,
        titulo: b.title ?? null,
        status: b.status ?? null,
        permalink: b.permalink ?? null,
        estoque: typeof b.available_quantity === 'number' ? b.available_quantity : null,
        sku: b.seller_custom_field ?? null,
        catalogo: b.catalog_listing === true,
      });
    }
  }
  return out;
}
