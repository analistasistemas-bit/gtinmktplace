export interface FaixaAtacado {
  min_unidades: number;
  desconto_pct: number;
}

export interface PrecoPxQ {
  type: 'standard';
  amount: number;
  currency_id: 'BRL';
  conditions: {
    context_restrictions: string[];
    min_purchase_unit?: number;
  };
}

/** Valor absoluto a partir do preço-base e do % de desconto. Arredonda a 2 casas. */
export function amountComDesconto(precoBase: number, pct: number): number {
  return Math.round(precoBase * (1 - pct / 100) * 100) / 100;
}

/**
 * Conjunto completo de preços PxQ: base (preço cheio, sem restrição) + faixas B2B.
 * faixas vazio → só a base (usado para LIMPAR o PxQ no ML). Ordena por min_unidades.
 */
export function montarFaixasPxQ(precoBase: number, faixas: FaixaAtacado[]): PrecoPxQ[] {
  const base: PrecoPxQ = {
    type: 'standard', amount: precoBase, currency_id: 'BRL',
    conditions: { context_restrictions: [] },
  };
  const tiers: PrecoPxQ[] = [...faixas]
    .sort((a, b) => a.min_unidades - b.min_unidades)
    .map((f) => ({
      type: 'standard',
      amount: amountComDesconto(precoBase, f.desconto_pct),
      currency_id: 'BRL',
      conditions: {
        context_restrictions: ['channel_marketplace', 'user_type_business'],
        min_purchase_unit: f.min_unidades,
      },
    }));
  return [base, ...tiers];
}

/**
 * Aplica o conjunto de preços PxQ no item (recurso separado, pós-criação).
 * PUT /items/{id}/prices com { prices: [...] }. Idempotente. Lança em erro HTTP.
 */
export async function aplicarPxQ(
  token: string, itemId: string, precoBase: number, faixas: FaixaAtacado[],
): Promise<void> {
  const prices = montarFaixasPxQ(precoBase, faixas);
  const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}/prices`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prices }),
  });
  if (!resp.ok) throw new Error(`PxQ (${resp.status}): ${await resp.text()}`);
}
