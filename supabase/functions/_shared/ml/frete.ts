// Frete que o VENDEDOR absorve quando o ML obriga frete grátis ao comprador
// (faixa de preço por categoria). Entra no "Você recebe" da Revisão para bater com o
// simulador de custos do ML. Recurso à parte da comissão; não bloqueia (best-effort).

import { type DimensoesPacote, dimensoesValidas } from './pacote.ts';
import type { ValorComProveniencia } from './proveniencia.ts';

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

const DIMENSOES_DEFAULT: DimensoesPacote = {
  altura_cm: 16,
  largura_cm: 11,
  comprimento_cm: 6,
  peso_gramas: 300,
};

/**
 * GET /users/{id}/shipping_options/free → custo de frete que o vendedor absorve (R$), ou 0
 * quando o comprador paga / falha. Clássico == Premium (mesmo custo), então uma chamada basta.
 * `mlUserId` é do vendedor: o desconto depende da reputação dele.
 * Quando dimensões não forem informadas ou forem inválidas, usa DIMENSOES_DEFAULT (16x11x6cm, 300g)
 * para a API do ML retornar a estimativa de frete da categoria.
 */
export async function buscarFreteVendedor(
  token: string,
  mlUserId: string,
  preco: number,
  categoria: string,
  dim?: DimensoesPacote | null,
): Promise<number> {
  return (await buscarFreteVendedorComProveniencia(token, mlUserId, preco, categoria, dim)).valor;
}

/**
 * Variante com proveniência, para a DRE (ADR-0148 D-2, implementa a D-28 da ADR-0141).
 *
 * O helper acima devolve `0` em três situações com significados opostos: o comprador paga
 * (resposta legítima), o ML não respondeu (ausência), e o schema veio incompleto. A DRE precisa
 * recusar nos dois últimos e calcular no primeiro — daí esta variante. O contrato do helper antigo
 * **não muda**: ele serve `process-familia`, `pulse-coletar`, `analisar-viabilidade` e
 * `calcular-tarifa-ml`, e lançar ali quebraria a publicação.
 *
 * Não confundir com o homônimo de `_shared/faturamento/io.ts:193`, que devolve `number | null`.
 */
export async function buscarFreteVendedorComProveniencia(
  token: string,
  mlUserId: string,
  preco: number,
  categoria: string,
  dim?: DimensoesPacote | null,
): Promise<ValorComProveniencia<number>> {
  const dimInformadas = !!(dim && dimensoesValidas(dim));
  const d = dimInformadas ? dim! : DIMENSOES_DEFAULT;
  const dimensions =
    `${Math.round(d.altura_cm!)}x${Math.round(d.largura_cm!)}x${Math.round(d.comprimento_cm!)},${Math.round(d.peso_gramas!)}`;
  const url = `https://api.mercadolibre.com/users/${mlUserId}/shipping_options/free`
    + `?dimensions=${dimensions}&item_price=${preco}&listing_type_id=gold_special`
    + `&condition=new&mode=me2&verbose=true&category_id=${categoria}`;

  let resp: Response;
  try {
    resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    return { valor: 0, proveniencia: 'estimated', motivo: `o Mercado Livre não respondeu o frete (${(e as Error).message})` };
  }
  if (!resp.ok) {
    return { valor: 0, proveniencia: 'estimated', motivo: `o Mercado Livre recusou o cálculo de frete (HTTP ${resp.status})` };
  }

  const ac = (await resp.json())?.coverage?.all_country as CoverageAllCountry | undefined;
  // 200 sem `coverage.all_country` é resposta vazia (ex.: item fora do me2), não frete zero.
  if (!ac) {
    return { valor: 0, proveniencia: 'estimated', motivo: 'o Mercado Livre respondeu sem cobertura de frete para este item' };
  }
  // Vendedor paga mas o ML não disse quanto: ausência, não zero.
  const vendedorPaga = ac.free_shipping_by_meli === true || ac.discount?.type === 'mandatory';
  if (vendedorPaga && !Number(ac.list_cost)) {
    return { valor: 0, proveniencia: 'estimated', motivo: 'o Mercado Livre disse que o vendedor paga o frete, mas não informou o valor' };
  }

  const valor = freteSeVendedorPaga(ac);
  return dimInformadas
    ? { valor, proveniencia: 'official' }
    : {
      valor,
      proveniencia: 'partial',
      motivo: 'o frete foi calculado com um pacote padrão porque as dimensões do produto não foram informadas',
    };
}

