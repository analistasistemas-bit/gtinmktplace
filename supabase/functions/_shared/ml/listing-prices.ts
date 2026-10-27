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

/**
 * Comissão para PRECIFICAR (emenda ADR-0020, 2026-10-27): retenta só 429/5xx (o ML devolve
 * `local_rate_limited` com famílias processando em paralelo) e só aceita comissão oficial —
 * `comissaoDe` transformaria resposta incompleta em 0%. Esgotou → lança; quem chama não precifica.
 */
export async function buscarComissaoParaPreco(
  token: string,
  preco: number,
  categoria: string,
  esperasMs: number[] = [1000, 3000],
): Promise<{ percentual: number; fixa: number }> {
  for (let tentativa = 0; ; tentativa++) {
    let lp: ListingPriceML;
    try {
      lp = await buscarListingPrice(token, preco, categoria, 'gold_special');
    } catch (e) {
      const status = Number(/listing_prices \S+ (\d{3})/.exec((e as Error).message)?.[1]);
      const transitorio = status === 429 || status >= 500;
      if (!transitorio || tentativa >= esperasMs.length) throw e;
      await new Promise((r) => setTimeout(r, esperasMs[tentativa]));
      continue;
    }
    const c = comissaoDeComProveniencia(lp);
    if (c.proveniencia !== 'official') throw new Error(`listing_prices sem sale_fee_details completo (${categoria})`);
    return c.valor;
  }
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
