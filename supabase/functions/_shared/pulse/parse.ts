import type { OfertaColetada, PriceToWin } from './tipos.ts';

// /products/{id}/items → results[]: item_id, price, seller_id, listing_type_id,
// shipping.free_shipping, official_store_id. sold/available vêm null — não parsear.
export function parseOfertasProduto(json: unknown): OfertaColetada[] {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: OfertaColetada[] = [];
  for (const r of results) {
    const o = r as Record<string, unknown>;
    const itemId = typeof o.item_id === 'string' ? o.item_id : null;
    const preco = typeof o.price === 'number' ? o.price : null;
    const sellerId = typeof o.seller_id === 'number' ? o.seller_id : null;
    if (!itemId || preco == null || sellerId == null) continue;
    out.push({
      item_id: itemId,
      seller_id: sellerId,
      preco,
      tier: typeof o.listing_type_id === 'string' ? o.listing_type_id : null,
      frete_gratis: Boolean((o.shipping as { free_shipping?: unknown } | null)?.free_shipping),
      loja_oficial: o.official_store_id != null,
    });
  }
  return out;
}

// /suggestions/items/{id}/details
export function parsePriceToWin(json: unknown): PriceToWin | null {
  const d = json as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || d.status == null) return null;
  const sug = (d.suggested_price as { amount?: unknown } | null)?.amount;
  const costs = d.costs as { selling_fees?: unknown; shipping_fees?: unknown } | null;
  return {
    status: typeof d.status === 'string' ? d.status : null,
    preco_sugerido: typeof sug === 'number' ? sug : null,
    custos: costs
      ? {
          comissao: typeof costs.selling_fees === 'number' ? costs.selling_fees : null,
          frete: typeof costs.shipping_fees === 'number' ? costs.shipping_fees : null,
        }
      : null,
  };
}
