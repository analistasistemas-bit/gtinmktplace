import type { ListingPriceML } from './tarifa.ts';

/** GET /sites/MLB/listing_prices para um preço/categoria/tipo de anúncio. Lança em erro HTTP. */
export async function buscarListingPrice(
  token: string,
  preco: number,
  categoria: string,
  listingType: string,
): Promise<ListingPriceML> {
  const url = `https://api.mercadolibre.com/sites/MLB/listing_prices?price=${preco}&category_id=${categoria}&listing_type_id=${listingType}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`listing_prices ${listingType} ${resp.status}: ${await resp.text()}`);
  return resp.json() as Promise<ListingPriceML>;
}

/** Comissão (%/fixa em R$) a partir da resposta de listing_prices. */
export function comissaoDe(lp: ListingPriceML): { percentual: number; fixa: number } {
  return {
    percentual: lp.sale_fee_details?.percentage_fee ?? 0,
    fixa: lp.sale_fee_details?.fixed_fee ?? 0,
  };
}
