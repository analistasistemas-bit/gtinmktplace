export interface Markup {
  lucro: number;
  markup: number;
}

/** Markup sobre o custo, a partir do líquido (após comissão ML). custo<=0 → markup 0. */
export function calcularMarkup(liquido: number, custo: number): Markup {
  const lucro = liquido - custo;
  return { lucro, markup: custo > 0 ? lucro / custo : 0 };
}
