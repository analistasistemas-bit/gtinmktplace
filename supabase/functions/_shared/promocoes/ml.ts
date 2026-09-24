// ADR-0170 — leitura das promoções do ML. SÓ GET: este arquivo não tem nenhum outro verbo HTTP.
import type { ItemML, ItemPromocaoML, PromocaoML, VariacaoML } from './tipos.ts';

type Obj = Record<string, unknown>;
export type GetJson = (path: string) => Promise<unknown>;
export class SemAcessoPromocoes extends Error {}
export const TIPOS_CUPOM = new Set(['SELLER_COUPON_CAMPAIGN']);

const API = 'https://api.mercadolibre.com';
const LIMITE = 50;
const ATRIBUTOS_ITEM = 'id,title,thumbnail,secure_thumbnail,permalink,listing_type_id,category_id,seller_custom_field,attributes,variations';

const num = (x: unknown): number | null => {
  const n = Number(x);
  return x == null || x === '' || !Number.isFinite(n) ? null : n;
};
const str = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
const lista = (x: unknown): Obj[] => (Array.isArray(x) ? (x as Obj[]) : []);
const atributo = (attrs: unknown, id: string): string | null => str(lista(attrs).find((a) => a.id === id)?.value_name);

export function criarGetJson(token: string, f: typeof fetch = fetch): GetJson {
  return async (path) => {
    const r = await f(`${API}${path}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    const rota = path.split('?')[0];
    if (r.status === 401 || r.status === 403) throw new SemAcessoPromocoes(`ML ${r.status} em ${rota}`);
    if (!r.ok) throw new Error(`ML ${r.status} em ${rota}`);
    return r.json();
  };
}

export function normalizarPromocao(raw: Obj): PromocaoML | null {
  const id = str(raw.id);
  if (!id) return null;
  return {
    id, tipo: str(raw.type) ?? 'DESCONHECIDO', nome: str(raw.name), status: str(raw.status) ?? 'desconhecido',
    inicio: str(raw.start_date), fim: str(raw.finish_date), prazo_adesao: str(raw.deadline_date),
    beneficios: raw.benefits && typeof raw.benefits === 'object' ? (raw.benefits as Obj) : null,
    bruto: raw,
  };
}

export function normalizarItemPromocao(raw: Obj): ItemPromocaoML | null {
  const id = str(raw.id);
  if (!id) return null;
  const stock = raw.stock && typeof raw.stock === 'object' ? (raw.stock as Obj) : null;
  return {
    ml_item_id: id, status: str(raw.status) ?? 'desconhecido',
    preco_original: num(raw.original_price), preco_promo: num(raw.price),
    preco_min: num(raw.min_discounted_price), preco_max: num(raw.max_discounted_price),
    preco_sugerido: num(raw.suggested_discounted_price),
    ml_pct: num(raw.meli_percentage), vendedor_pct: num(raw.seller_percentage),
    estoque_min: num(stock?.min), estoque_max: num(stock?.max),
  };
}

export function normalizarItemML(raw: Obj): ItemML {
  const variacoes: VariacaoML[] = lista(raw.variations)
    .map((v) => ({
      variation_id: Number(v.id),
      cor: atributo(v.attribute_combinations, 'COLOR'),
      sku: str(v.seller_custom_field) ?? atributo(v.attributes, 'SELLER_SKU'),
      gtin: atributo(v.attributes, 'GTIN'),
    }))
    .filter((v) => Number.isFinite(v.variation_id));
  return {
    id: String(raw.id), titulo: str(raw.title),
    thumbnail: (str(raw.secure_thumbnail) ?? str(raw.thumbnail))?.replace(/^http:\/\//, 'https://') ?? null, permalink: str(raw.permalink),
    listing_type_id: str(raw.listing_type_id), categoria: str(raw.category_id),
    sku: str(raw.seller_custom_field) ?? atributo(raw.attributes, 'SELLER_SKU'),
    gtin: atributo(raw.attributes, 'GTIN'),
    variacoes,
  };
}

export async function listarPromocoes(get: GetJson, mlUserId: string): Promise<PromocaoML[]> {
  const out: PromocaoML[] = [];
  let lidos = 0;
  for (let offset = 0; offset < 10_000; offset += LIMITE) {
    const r = (await get(`/seller-promotions/users/${mlUserId}?app_version=v2&limit=${LIMITE}&offset=${offset}`)) as Obj;
    const res = lista(r.results);
    lidos += res.length;
    for (const x of res) {
      const p = normalizarPromocao(x);
      if (p) out.push(p);
    }
    if (res.length < LIMITE) {
      const total = num(r.paging && typeof r.paging === 'object' ? (r.paging as Obj).total : null);
      if (total != null && lidos < total) throw new Error(`promoções do usuário ${mlUserId}: lidas ${lidos} de ${total}`);
      return out;
    }
  }
  throw new Error(`paginação das promoções do usuário ${mlUserId} não terminou em 10000 registros`);
}

export async function listarItensPromocao(get: GetJson, p: PromocaoML): Promise<ItemPromocaoML[]> {
  const out: ItemPromocaoML[] = [];
  const base = `/seller-promotions/promotions/${encodeURIComponent(p.id)}/items?promotion_type=${encodeURIComponent(p.tipo)}&app_version=v2&limit=${LIMITE}`;
  let cursor: string | null = null;
  for (let pagina = 0; pagina < 400; pagina++) {
    const r = (await get(cursor ? `${base}&search_after=${encodeURIComponent(cursor)}` : base)) as Obj;
    const res = lista(r.results);
    for (const x of res) {
      const it = normalizarItemPromocao(x);
      if (it) out.push(it);
    }
    const paging = r.paging && typeof r.paging === 'object' ? (r.paging as Obj) : {};
    const prox = str(paging.searchAfter) ?? str(paging.search_after);
    if (!prox || res.length === 0 || prox === cursor) return out;
    cursor = prox;
  }
  throw new Error(`paginação dos itens da promoção ${p.id} não terminou em 400 páginas`);
}

export async function buscarItensML(get: GetJson, ids: string[]): Promise<Map<string, ItemML>> {
  const m = new Map<string, ItemML>();
  for (let i = 0; i < ids.length; i += 20) {
    const bloco = ids.slice(i, i + 20);
    const r = await get(`/items?ids=${encodeURIComponent(bloco.join(','))}&attributes=${ATRIBUTOS_ITEM}&include_attributes=all`);
    for (const x of lista(r)) {
      if (x.code === 200 && x.body && typeof x.body === 'object') {
        const it = normalizarItemML(x.body as Obj);
        m.set(it.id, it);
      }
    }
  }
  return m;
}
