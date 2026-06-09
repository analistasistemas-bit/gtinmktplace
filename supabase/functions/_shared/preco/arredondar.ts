/** Número de incrementos de R$ 0,05, limpo de lixo de ponto-flutuante. */
function passosDe5(valor: number): number {
  return Math.round((valor / 0.05) * 1e6) / 1e6;
}

function emReais(passos: number): number {
  return Math.round((passos / 20) * 100) / 100;
}

/** Múltiplo de R$ 0,05 mais próximo. Ex.: 28,56 → 28,55; 28,58 → 28,60. */
export function arredondar5Proximo(valor: number): number {
  return emReais(Math.round(passosDe5(valor)));
}

/** Menor múltiplo de R$ 0,05 ≥ valor (arredonda pra cima). Garante o piso. */
export function arredondar5Cima(valor: number): number {
  return emReais(Math.ceil(passosDe5(valor)));
}
