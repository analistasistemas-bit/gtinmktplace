const API = 'https://api.mercadolibre.com';

/** Monta URL + body do POST de mensagem pós-venda conforme a API do ML:
 *  POST /messages/packs/{pack}/sellers/{seller}?tag=post_sale  com body { from, to, text }.
 *  Puro — testável sem rede. (v1 sem anexos, ADR-0067.) */
export function montarReqMsgML(
  packId: string | number, sellerId: string | number, buyerId: string | number, texto: string,
): { url: string; body: string } {
  return {
    url: `${API}/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale`,
    body: JSON.stringify({ from: { user_id: String(sellerId) }, to: { user_id: String(buyerId) }, text: texto }),
  };
}

/** POST de mensagem pós-venda ao ML. Retorna a Response crua — o caller decide relançar
 *  (reply interativo) ou engolir (welcome fire-and-forget). */
export async function enviarMsgML(
  token: string, packId: string | number, sellerId: string | number, buyerId: string | number, texto: string,
): Promise<Response> {
  const { url, body } = montarReqMsgML(packId, sellerId, buyerId, texto);
  return await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(15000),
  });
}

/** Envia mensagem ao comprador no contexto de um pedido/pack. Não relança em erro — falha de
 *  mensagem não deve travar o worker de sync da venda. */
export async function enviarMensagemPedido(
  token: string,
  packId: string | number,
  sellerId: string,
  buyerId: string,
  texto: string,
): Promise<void> {
  const r = await enviarMsgML(token, packId, sellerId, buyerId, texto);
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    console.error(`[mensagem-ml] pack=${packId} status=${r.status}: ${err}`);
  }
}
