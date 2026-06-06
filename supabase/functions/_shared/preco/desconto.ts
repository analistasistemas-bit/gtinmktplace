/** Preço "de" (riscado) inflado a partir do preço de venda. Null = sem selo. */
export function calcularPrecoDe(preco: number, pct: number): number | null {
  if (preco <= 0 || pct <= 0 || pct >= 100) return null;
  return Math.round((preco / (1 - pct / 100)) * 100) / 100;
}

/** % efetivo: override da família quando presente, senão o global. */
export function pctEfetivo(familiaPct: number | null, globalPct: number): number {
  return familiaPct ?? globalPct;
}
