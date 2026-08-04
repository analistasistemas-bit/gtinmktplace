import type { DadosOfertas } from './tipos.ts';
import { pool } from './pool.ts';

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

interface MLItem {
  item_id?: string;
  seller_id?: number | string;
  price?: number;
  sale_price?: { amount?: number } | null;
  category_id?: string;
  shipping?: { free_shipping?: boolean; logistic_type?: string };
}

/** Anexa o preço efetivo de `/items/{id}/sale_price` às ofertas do catálogo. */
export async function enriquecerItensComPrecosVenda(
  json: unknown,
  buscarPreco: (itemId: string) => Promise<number | null>,
): Promise<unknown> {
  const results = (json as { results?: MLItem[] } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) return json;

  const enriquecidos = await pool(4, results, async (item) => {
    if (typeof item.item_id !== 'string' || item.item_id.length === 0) return item;
    try {
      const amount = await buscarPreco(item.item_id);
      return typeof amount === 'number' && amount > 0
        ? { ...item, sale_price: { amount } }
        : item;
    } catch {
      return item;
    }
  });

  return { ...(json as object), results: enriquecidos };
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
