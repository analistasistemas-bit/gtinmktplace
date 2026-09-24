// ADR-0169 — Monitor de frete. Este módulo é testado por vitest (Node): nada de import
// Deno-only aqui. A fiação com o client admin vive em monitor-frete-deps.ts.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Alta de frete que merece aviso: > 10% E ≥ R$ 2. Nulo/zero em qualquer lado não compara
 *  (nulo = /shipments/costs falhou; 0 = sem custo ao vendedor — incidente de 2026-07-30). */
export function avaliarAltaFrete(
  atual: number | null, anterior: number | null,
): { diferenca: number; pct: number } | null {
  if (atual == null || anterior == null || atual <= 0 || anterior <= 0) return null;
  const diferenca = round2(atual - anterior);
  if (diferenca < 2 || atual <= anterior * 1.1) return null;
  return { diferenca, pct: Math.round((atual / anterior - 1) * 100) };
}
