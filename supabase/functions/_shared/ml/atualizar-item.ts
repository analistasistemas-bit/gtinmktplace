import type { MLVariacaoAtual, VariacaoUpdate } from './atualizar.ts';

export interface ItemMLAtual {
  id: string;
  variations: MLVariacaoAtual[];
}

function erroML(status: number, json: unknown): Error {
  const detalhe = (json as { message?: string })?.message ?? JSON.stringify(json);
  const e = new Error(`ML rejeitou (${status}): ${detalhe}`);
  (e as { status?: number }).status = status;
  return e;
}

// Estado real do anúncio: ids + seller_custom_field + estoque de cada variação.
export async function buscarItemML(accessToken: string, itemId: string): Promise<ItemMLAtual> {
  const url = `https://api.mercadolibre.com/items/${itemId}?attributes=id,variations`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await resp.json();
  if (!resp.ok) throw erroML(resp.status, json);
  const variations = (json.variations ?? []).map((v: Record<string, unknown>) => ({
    id: v.id as string | number,
    seller_custom_field: (v.seller_custom_field as string | null) ?? null,
    available_quantity: (v.available_quantity as number) ?? 0,
  }));
  return { id: String(json.id), variations };
}

// Atualiza só as variações (estoque). PUT /items/{id} com variations[].
export async function atualizarItemML(
  accessToken: string,
  itemId: string,
  variations: VariacaoUpdate[],
): Promise<void> {
  const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ variations }),
  });
  if (!resp.ok) throw erroML(resp.status, await resp.json().catch(() => ({})));
}
