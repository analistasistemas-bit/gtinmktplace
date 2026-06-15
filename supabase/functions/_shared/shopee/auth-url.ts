// Monta a URL de autorização da loja Shopee (OAuth, ADR-0011).
// A assinatura é PUBLIC (partner_id + path + timestamp) e é async (HMAC via
// crypto.subtle), então a montagem da query (pura/testável) recebe o `sign` e o
// `timestamp` já calculados; quem chama (a edge function) assina antes.

export const PATH_AUTH_PARTNER = '/api/v2/shop/auth_partner';

/** Monta a query string de `auth_partner` a partir dos params já calculados (pura). */
export function montarAuthUrlShopee(
  host: string,
  partnerId: string,
  timestamp: number,
  sign: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    partner_id: partnerId,
    timestamp: String(timestamp),
    sign,
    redirect: redirectUri,
  });
  return `${host}${PATH_AUTH_PARTNER}?${params.toString()}`;
}
