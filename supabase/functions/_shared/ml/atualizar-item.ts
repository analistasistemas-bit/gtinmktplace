import type { MLVariacaoAtual, VariacaoUpdate, VariacaoNovaPut } from './atualizar.ts';

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

export interface ResultadoUpdate {
  variations: Array<{ id: string | number; seller_custom_field?: string | null }>;
}

// Atualiza variações existentes (com id, só estoque) e cria as novas (sem id).
// Opcionalmente reenvia atributos de item (ex.: BRAND) — só os passados; o ML mescla por id,
// preservando os demais atributos do anúncio.
// Retorna as variations do item (com ids) para casar as novas por seller_custom_field.
export async function atualizarItemML(
  accessToken: string,
  itemId: string,
  variations: Array<VariacaoUpdate | VariacaoNovaPut>,
  atributos?: Array<{ id: string; value_name?: string; value_id?: string }>,
): Promise<ResultadoUpdate> {
  const body: Record<string, unknown> = { variations };
  if (atributos && atributos.length > 0) body.attributes = atributos;
  const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw erroML(resp.status, json);
  return { variations: (json as { variations?: ResultadoUpdate['variations'] }).variations ?? [] };
}
