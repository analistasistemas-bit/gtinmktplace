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
