import type { Comissao } from './sugerir.ts';

/**
 * Líquido que o vendedor recebe por venda no modo Clássico (gold_special).
 * NÃO arredonda — o valor é comparado com o custo para detectar prejuízo.
 * `comissao=null` → tratada como comissão 0 (comissão indisponível; subtrai só frete/imposto).
 * `frete` = custo de frete grátis que o vendedor absorve (R$, 0 se comprador paga).
 * `aliquotaPct` = imposto por origem em % (0 = sem imposto).
 */
export function liquidoClassico(
  preco: number,
  comissao: Comissao | null,
  frete = 0,
  aliquotaPct = 0,
): number {
  const percentual = comissao?.percentual ?? 0;
  const fixa = comissao?.fixa ?? 0;
  return preco - (preco * percentual / 100 + fixa) - frete - preco * aliquotaPct / 100;
}
