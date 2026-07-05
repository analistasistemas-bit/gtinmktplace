// E6 (ADR-0061): o tipo é dono no contrato; importado p/ uso local e re-exportado p/ compat.
import type { FaixaAtacado } from '../canais/contrato.ts';
export type { FaixaAtacado };

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
 * Faixas de preço por quantidade (PxQ B2B) — SÓ as faixas. O preço base do anúncio é
 * gerido à parte e NÃO entra neste endpoint (incluí-lo dá 400 marketplace.context.is.mandatory).
 * Ordena por min_unidades. faixas vazio → [] (o POST com {prices:[]} limpa as faixas no ML).
 */
export function montarFaixasPxQ(precoBase: number, faixas: FaixaAtacado[]): PrecoPxQ[] {
  return [...faixas]
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
}

/**
 * Define as faixas de PxQ do item (recurso separado, pós-criação).
 * POST /items/{id}/prices/standard/quantity com { prices: [faixas] } — full-replace:
 * o conjunto enviado substitui o anterior; { prices: [] } limpa. Idempotente. Lança em erro HTTP.
 * (Contrato confirmado: PUT/GET/DELETE nesse path dão 405; POST é o único método.)
 */
export async function aplicarPxQ(
  token: string, itemId: string, precoBase: number, faixas: FaixaAtacado[],
): Promise<void> {
  const prices = montarFaixasPxQ(precoBase, faixas);
  const resp = await fetch(`https://api.mercadolibre.com/items/${itemId}/prices/standard/quantity`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prices }),
  });
  if (!resp.ok) throw new Error(`PxQ (${resp.status}): ${await resp.text()}`);
}
