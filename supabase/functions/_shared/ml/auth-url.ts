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
  return `https://auth.mercadolibre.com.br/authorization?${params.toString()}`;
}
