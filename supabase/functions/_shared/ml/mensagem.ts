const API = 'https://api.mercadolibre.com';

/** Envia mensagem ao comprador no contexto de um pedido/pack. Não relança em erro — falha de
 *  mensagem não deve travar o worker de sync da venda. */
export async function enviarMensagemPedido(
  token: string,
  packId: string | number,
  sellerId: string,
  texto: string,
): Promise<void> {
  const r = await fetch(`${API}/messages/packs/${packId}/sellers/${sellerId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texto, message_attachments: null }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => '');
    console.error(`[mensagem-ml] pack=${packId} status=${r.status}: ${err}`);
  }
}
