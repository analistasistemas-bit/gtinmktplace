const API = 'https://api.mercadolibre.com';

/** Monta URL + body do POST de mensagem pós-venda conforme a API do ML:
 *  POST /messages/packs/{pack}/sellers/{seller}?tag=post_sale  com body { from, to, text, attachments? }.
 *  `anexo` = nome devolvido pelo upload ao ML. Puro — testável sem rede. */
export function montarReqMsgML(
  packId: string | number, sellerId: string | number, buyerId: string | number, texto: string,
  anexo?: string | null,
): { url: string; body: string } {
  return {
    url: `${API}/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale`,
    body: JSON.stringify({
      from: { user_id: String(sellerId) }, to: { user_id: String(buyerId) }, text: texto,
      ...(anexo ? { attachments: [anexo] } : {}),
    }),
  };
}

/** POST de mensagem pós-venda ao ML. Retorna a Response crua — usado pelo reply interativo
 *  (`depsMensagemReal`, que classifica a resposta). */
export async function enviarMsgML(
  token: string, packId: string | number, sellerId: string | number, buyerId: string | number, texto: string,
  anexo?: string | null,
): Promise<Response> {
  const { url, body } = montarReqMsgML(packId, sellerId, buyerId, texto, anexo);
  return await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(15000),
  });
}
