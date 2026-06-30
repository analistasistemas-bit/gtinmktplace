// Frete que o VENDEDOR absorve quando o ML obriga frete grátis ao comprador
// (faixa de preço por categoria). Entra no "Você recebe" da Revisão para bater com o
// simulador de custos do ML. Recurso à parte da comissão; não bloqueia (best-effort).

import { type DimensoesPacote, dimensoesValidas } from './pacote.ts';

interface CoverageAllCountry {
  list_cost?: number;
  free_shipping_by_meli?: boolean;
  discount?: { type?: string };
}

/**
 * Decide o custo que o vendedor paga a partir de coverage.all_country.
 * Contrato confirmado em produção (2026-06-30, conta B2B AVILBV, cat MLB270273):
 * - preço < limite da categoria: `free_shipping_by_meli` ausente, type "none" → comprador paga → 0.
 * - faixa incentivada (ex.: R$19–78): `free_shipping_by_meli: true` → vendedor paga `list_cost`.
 * - acima do limite nacional (ex.: ≥ R$79): `discount.type: "mandatory"` → vendedor paga `list_cost`.
 * O `list_cost` já vem com o desconto de reputação aplicado (valor líquido do vendedor).
 */
export function freteSeVendedorPaga(ac: CoverageAllCountry | undefined): number {
  if (!ac) return 0;
  const vendedorPaga = ac.free_shipping_by_meli === true || ac.discount?.type === 'mandatory';
  return vendedorPaga ? (Number(ac.list_cost) || 0) : 0;
}

/**
 * GET /users/{id}/shipping_options/free → custo de frete que o vendedor absorve (R$), ou 0
 * quando o comprador paga / dimensões inválidas / falha. Clássico == Premium (mesmo custo),
 * então uma chamada basta. `mlUserId` é do vendedor: o desconto depende da reputação dele.
 */
export async function buscarFreteVendedor(
  token: string,
  mlUserId: string,
  preco: number,
  categoria: string,
  dim: DimensoesPacote,
): Promise<number> {
  if (!dimensoesValidas(dim)) return 0;
  const dimensions =
    `${Math.round(dim.altura_cm!)}x${Math.round(dim.largura_cm!)}x${Math.round(dim.comprimento_cm!)},${Math.round(dim.peso_gramas!)}`;
  const url = `https://api.mercadolibre.com/users/${mlUserId}/shipping_options/free`
    + `?dimensions=${dimensions}&item_price=${preco}&listing_type_id=gold_special`
    + `&condition=new&mode=me2&verbose=true&category_id=${categoria}`;

  let resp: Response;
  try {
    resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return 0;
  }
  if (!resp.ok) return 0;
  const ac = (await resp.json())?.coverage?.all_country as CoverageAllCountry | undefined;
  return freteSeVendedorPaga(ac);
}
