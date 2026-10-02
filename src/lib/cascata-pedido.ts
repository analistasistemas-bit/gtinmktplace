// Cascata de dinheiro de um pedido (detalhe da venda): venda − comissão − frete = líquido após ML,
// depois imposto e custo até a margem de contribuição. Pura e testável; nenhum cálculo novo de
// líquido/imposto/markup — só reapresenta os números que `agruparPorPedido` já fechou.
import type { Pedido } from './pedidos-faturamento';
import { round2 } from './formato';

export interface CascataPedido {
  /** Valor da venda que conta como faturamento (`brutoFaturavel`). */
  venda: number;
  comissao: number;
  /** Frete do vendedor; 0 quando o pedido todo é cancelado/devolvido. */
  frete: number;
  /** Resíduo para a conta fechar (arredondamento, estorno parcial); 0 na maioria dos pedidos. */
  ajustes: number;
  /** `liquido + imposto`: líquido após ML, antes do imposto estimado (ADR-0042/0055). */
  recebido: number;
  imposto: number;
  /** Média da alíquota ponderada pelo valor dos itens tributados. null sem imposto/alíquota. */
  aliquotaPct: number | null;
  custo: number | null;
  /** Há item faturável e todos têm custo. Sem isso a margem não é confiável. */
  custoCompleto: boolean;
  /** Margem de contribuição em R$ = venda − comissão − frete − ajustes − imposto − custo = `liquido − custo`. */
  margem: number | null;
  /** Margem ÷ venda × 100. */
  margemPct: number | null;
  markup: number | null;
}

export function cascataDoPedido(p: Pedido): CascataPedido {
  // Alíquota exibida vem de `it.aliquotaPct` (valor cru do resolver — 8/16, ADR-0055), nunca de
  // `imposto ÷ valor` (o imposto é arredondado a centavos). Média ponderada cobre origens mistas.
  const tributados = p.itens.filter((it) => it.imposto > 0 && it.aliquotaPct != null);
  const baseTributada = tributados.reduce((s, it) => s + it.unit_price * it.quantity, 0);
  const aliquotaPct = baseTributada > 0
    ? tributados.reduce((s, it) => s + (it.aliquotaPct ?? 0) * it.unit_price * it.quantity, 0) / baseTributada
    : null;

  const venda = p.brutoFaturavel;
  const frete = p.faturavel ? p.frete ?? 0 : 0;
  const recebido = round2(p.liquido + p.imposto);
  const faturaveis = p.itens.filter((it) => it.faturavel);
  const custoCompleto = faturaveis.length > 0 && faturaveis.every((it) => it.custo != null);
  const margem = custoCompleto && p.custo != null ? round2(p.liquido - p.custo) : null;
  return {
    venda,
    comissao: p.comissao,
    frete,
    ajustes: round2(venda - p.comissao - frete - recebido),
    recebido,
    imposto: p.imposto,
    aliquotaPct,
    custo: p.custo,
    custoCompleto,
    margem,
    margemPct: margem != null && venda > 0 ? (margem / venda) * 100 : null,
    markup: p.markup,
  };
}
