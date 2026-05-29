export function montarAuthUrl(
  state: string,
  clientId: string,
  redirectUri: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  // Brasil usa o domínio "mercadolivre.com.br" (PT) para autorização;
  // o endpoint de token é api.mercadolibre.com (com "b", global).
  return `https://auth.mercadolivre.com.br/authorization?${params.toString()}`;
}
