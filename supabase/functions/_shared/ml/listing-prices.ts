import type { ListingPriceML } from './tarifa.ts';
import type { ValorComProveniencia } from './proveniencia.ts';

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
  return comissaoDeComProveniencia(lp).valor;
}

/**
 * Variante com proveniência, para a DRE (ADR-0148 D-2). O `?? 0` acima transforma schema
 * incompleto em comissão zero, que a DRE leria como "produto sem comissão" — lucro inflado. Aqui
 * a ausência do bloco `sale_fee_details` é declarada, e zero explícito continua sendo resposta.
 */
export function comissaoDeComProveniencia(
  lp: ListingPriceML,
): ValorComProveniencia<{ percentual: number; fixa: number }> {
  const d = lp.sale_fee_details;
  if (!d || d.percentage_fee == null || d.fixed_fee == null) {
    return {
      valor: { percentual: d?.percentage_fee ?? 0, fixa: d?.fixed_fee ?? 0 },
      proveniencia: 'estimated',
      motivo: 'o Mercado Livre respondeu sem `sale_fee_details` — a comissão não veio detalhada',
    };
  }
  return { valor: { percentual: d.percentage_fee, fixa: d.fixed_fee }, proveniencia: 'official' };
}
