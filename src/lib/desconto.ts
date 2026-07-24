import type { Familia } from './tipos-dominio';

export function calcularPrecoDe(preco: number, pct: number): number | null {
  if (preco <= 0 || pct <= 0 || pct >= 100) return null;
  return Math.round((preco / (1 - pct / 100)) * 100) / 100;
}

export function pctEfetivo(familiaPct: number | null, globalPct: number): number {
  return familiaPct ?? globalPct;
}

/** User Products não aceita o `original_price` usado pelo desconto apenas visual.
 * Uma configuração antiga continua liberada somente para poder ser desligada. */
export function podeAlterarDescontoVisual(
  formato: Familia['formatoPublicacaoMl'],
  atualmenteAtivo: boolean,
): boolean {
  return formato !== 'user_products' || atualmenteAtivo;
}
