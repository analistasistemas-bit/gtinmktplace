import type { MlVariacaoExistente } from '../update/reconciliar.ts';

// Variações reais do anúncio (id, SKU, cor, estoque) para a reconciliação do ingest
// (adendo ADR-0016). O `buscarItemML` do worker não traz a cor (attribute_combinations);
// aqui extraímos o COLOR para dar nome à variação re-casada.
export async function buscarVariacoesExistentesML(
  accessToken: string,
  itemId: string,
): Promise<MlVariacaoExistente[]> {
  const url = `https://api.mercadolibre.com/items/${itemId}?attributes=id,variations`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const json = await resp.json();
  if (!resp.ok) {
    const msg = (json as { message?: string })?.message ?? JSON.stringify(json);
    throw new Error(`buscarVariacoesExistentesML ${resp.status}: ${msg}`);
  }
  const variations = ((json as { variations?: unknown[] }).variations ?? []) as Array<Record<string, unknown>>;
  return variations.map((v) => {
    const combos = (v.attribute_combinations as Array<Record<string, unknown>> | undefined) ?? [];
    const corAttr = combos.find((a) => a.id === 'COLOR' || a.name === 'Cor');
    return {
      id: String(v.id),
      seller_custom_field: (v.seller_custom_field as string | null) ?? null,
      cor: (corAttr?.value_name as string | null) ?? null,
      available_quantity: (v.available_quantity as number | null) ?? null,
    };
  });
}
