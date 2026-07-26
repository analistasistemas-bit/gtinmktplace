// Leitura de GTIN dos anúncios do ML, usada como fallback do enriquecimento do faturamento
// quando o GTIN não veio pelo caminho principal.

const API = 'https://api.mercadolibre.com';

interface ItemComAtributos {
  id?: string | null;
  attributes?: Array<{ id?: string | null; value_name?: string | null }> | null;
}

/** Extrai o GTIN do item do ML a partir do array de attributes. null se ausente. Pura. */
export function extrairGtin(item: ItemComAtributos | null | undefined): string | null {
  const attr = (item?.attributes ?? []).find((a) => a?.id === 'GTIN');
  const v = attr?.value_name;
  return v ? String(v).trim() : null;
}

/**
 * GTIN de cada anúncio (ml_item_id → gtin) via /items multiget em lote (20 por chamada). Usado
 * só para os anúncios que não casaram custo por variação/item (fallback). Resiliente: bloco que
 * falha é ignorado (aqueles anúncios ficam sem markup). Devolve só os que têm GTIN.
 */
export async function buscarGtinsDosItens(
  token: string,
  itemIds: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (itemIds.length === 0) return out;
  const headers = { Authorization: `Bearer ${token}` };
  const signal = AbortSignal.timeout(25_000);

  for (let i = 0; i < itemIds.length; i += 20) {
    const bloco = itemIds.slice(i, i + 20);
    try {
      const url = `${API}/items?ids=${bloco.join(',')}&attributes=id,attributes`;
      const resp = await fetch(url, { headers, signal });
      if (!resp.ok) continue;
      const arr = await resp.json(); // [{ code, body: { id, attributes } }]
      if (!Array.isArray(arr)) continue;
      for (const e of arr) {
        if (e?.code !== 200) continue;
        const id = e?.body?.id;
        const gtin = extrairGtin(e?.body);
        if (id && gtin) out[id] = gtin;
      }
    } catch {
      // Bloco indisponível: aqueles anúncios ficam sem GTIN → sem markup. Não derruba os demais.
      continue;
    }
  }
  return out;
}
