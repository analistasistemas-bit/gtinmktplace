import type { PayloadItem } from './publicar.ts';

export interface ResultadoItem {
  id: string;
  permalink: string;
  variations: Array<{ id: string | number; seller_custom_field?: string }>;
}

export async function criarItemML(accessToken: string, payload: PayloadItem): Promise<ResultadoItem> {
  const resp = await fetch('https://api.mercadolibre.com/items', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const detalhe = json?.message ?? JSON.stringify(json);
    const e = new Error(`ML rejeitou (${resp.status}): ${detalhe}`);
    (e as { status?: number }).status = resp.status;
    throw e;
  }
  return { id: json.id, permalink: json.permalink, variations: json.variations ?? [] };
}
