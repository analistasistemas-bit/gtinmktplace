import { parseSalePrice, type PrecoObservado } from '../trafego/parsers.ts';

/**
 * `GET /items/{id}/sale_price?context=channel_marketplace` — o preço que o comprador paga. Em
 * promoção, `regular_amount` (→ `precoRegular`) é o preço "de"; sem promoção vem null (spike 052
 * §3). Nunca lança; timeout de 5 s para uma chamada pendurada não segurar a resposta inteira.
 */
export async function lerSalePriceML(accessToken: string, itemId: string): Promise<PrecoObservado | null> {
  try {
    const resp = await fetch(
      `https://api.mercadolibre.com/items/${itemId}/sale_price?context=channel_marketplace`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(5_000) },
    );
    if (!resp.ok) { console.warn(`lerSalePriceML ML ${resp.status} (${itemId})`); return null; }
    return parseSalePrice(await resp.json().catch(() => null));
  } catch (e) {
    console.warn(`lerSalePriceML falhou (${itemId}):`, (e as Error).message);
    return null;
  }
}
