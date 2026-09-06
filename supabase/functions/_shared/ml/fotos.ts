// POST /pictures com { source } (validado no bug bash Task 13: /pictures/items/upload
// retornava 405 tengine; /pictures aceita JSON e retorna o picture id).
export async function subirFotoML(accessToken: string, sourceUrl: string): Promise<string> {
  const resp = await fetch('https://api.mercadolibre.com/pictures', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: sourceUrl }),
  });
  if (!resp.ok) {
    throw new Error(`Falha ao subir foto (${resp.status}): ${await resp.text()}`);
  }
  const json = await resp.json();
  return json.id as string;
}

// `GET /pictures/{id}`: bug real do Kit Virtual (2026-09-06) — o POST /items/kits recusa com
// `thumbnail.secureUrl must not be null` quando o payload manda só `thumbnail.id` (a doc oficial
// mostra o `id` sozinho, mas o ML exige os dois na prática). A resposta deste endpoint NÃO tem
// `secure_url` no topo (chaves reais: id, max_size, dominant_color, hash, crop, variations,
// status, origin) — só dentro de `variations[].secure_url`. Chamado sempre, tanto pro picture_id
// recém-subido quanto pro que já estava salvo de um upload anterior (D-5): não há retorno de
// upload pra reaproveitar nesse segundo caso.
export async function buscarSecureUrlFotoML(accessToken: string, pictureId: string): Promise<string> {
  const resp = await fetch(`https://api.mercadolibre.com/pictures/${pictureId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`Falha ao buscar a foto no Mercado Livre (${resp.status}): ${await resp.text()}`);
  }
  const json = await resp.json().catch(() => ({})) as { variations?: { secure_url?: unknown }[] };
  const secureUrl = json.variations?.[0]?.secure_url;
  if (typeof secureUrl !== 'string' || !secureUrl) {
    throw new Error('O Mercado Livre não devolveu a URL segura (secure_url) da foto.');
  }
  return secureUrl;
}
