import type { DadosOfertas } from './tipos.ts';

/** Extrai o product_id (catálogo) do 1º resultado de `/products/search`. null se vazio. */
export function parseProdutoBusca(json: unknown): string | null {
  const results = (json as { results?: Array<{ id?: string }> } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const id = results[0]?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Extrai o `name` do 1º produto de catálogo de `/products/search`. null se ausente. */
export function parseNomeProdutoBusca(json: unknown): string | null {
  const nome = (json as { results?: Array<{ name?: string }> } | null)?.results?.[0]?.name;
  return typeof nome === 'string' && nome.length > 0 ? nome : null;
}

/**
 * Extrai `short_description.content` do payload de `GET /products/{id}` (spike 037, §7.1).
 * Defensivo: ficha antiga/incompleta não pode derrubar a análise de viabilidade — ausência,
 * `null`, tipo inesperado ou string vazia sempre viram `null`, nunca lançam.
 */
export function parseDescricaoCatalogo(json: unknown): string | null {
  const content = (json as { short_description?: { content?: unknown } } | null)
    ?.short_description?.content;
  return typeof content === 'string' && content.length > 0 ? content : null;
}

interface MLItem {
  item_id?: string;
  seller_id?: number | string;
  price?: number;
  sale_price?: { amount?: number } | null;
  category_id?: string;
  shipping?: { free_shipping?: boolean; logistic_type?: string };
}

/** Aplica às ofertas o preço vigente da publicação ganhadora do catálogo. */
export function aplicarPrecoVencedorCatalogo(json: unknown, produto: unknown): unknown {
  const results = (json as { results?: MLItem[] } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) return json;

  const vencedor = (produto as {
    buy_box_winner?: { item_id?: unknown; price?: unknown } | null;
  } | null)?.buy_box_winner;
  if (
    typeof vencedor?.item_id !== 'string' ||
    typeof vencedor.price !== 'number' ||
    vencedor.price <= 0
  ) return json;
  const precoVencedor = vencedor.price;

  return {
    ...(json as object),
    results: results.map((item) => item.item_id === vencedor.item_id
      ? { ...item, sale_price: { amount: precoVencedor } }
      : item),
  };
}

/**
 * Extrai dados de ofertas de `/products/{id}/items`: faixa de preço, frete grátis,
 * logística FULL e lista de seller_ids distintos.
 * Estrutura real: `{ results: [{ seller_id, price, shipping }] }`.
 */
export function parseItensProduto(json: unknown): DadosOfertas {
  const vazio: DadosOfertas = {
    vendedores: 0, preco_min: null, preco_max: null, total_ofertas: 0,
    frete_gratis: 0, full: 0, seller_ids: [], category_id: null, ofertas_detalhe: [],
  };
  const results = (json as { results?: MLItem[] } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) return vazio;

  const precosEfetivos = results.map((r) =>
    typeof r.sale_price?.amount === 'number' && r.sale_price.amount > 0
      ? r.sale_price.amount
      : r.price
  );
  const precos = precosEfetivos
    .filter((p): p is number => typeof p === 'number' && p > 0);
  const sellers = [
    ...new Set(
      results
        .map((r) => (r.seller_id != null ? Number(r.seller_id) : null))
        .filter((id): id is number => id != null && !Number.isNaN(id)),
    ),
  ];
  const frete_gratis = results.filter((r) => r.shipping?.free_shipping === true).length;
  const full = results.filter((r) => r.shipping?.logistic_type === 'fulfillment').length;
  const category_id = results
    .map((r) => r.category_id)
    .find((c): c is string => typeof c === 'string' && c.length > 0) ?? null;
  const ofertas_detalhe = results.map((r, i) => ({
    seller_id: r.seller_id != null ? Number(r.seller_id) : null,
    preco: typeof precosEfetivos[i] === 'number' && precosEfetivos[i] > 0 ? precosEfetivos[i] : null,
  }));

  return {
    vendedores: sellers.length > 0 ? sellers.length : results.length,
    preco_min: precos.length ? precos.reduce((a, b) => Math.min(a, b)) : null,
    preco_max: precos.length ? precos.reduce((a, b) => Math.max(a, b)) : null,
    total_ofertas: results.length,
    frete_gratis,
    full,
    seller_ids: sellers,
    category_id,
    ofertas_detalhe,
  };
}
