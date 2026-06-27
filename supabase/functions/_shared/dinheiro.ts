/** Arredonda a 2 casas (centavos). Fonte única do arredondamento monetário no backend (Deno). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
