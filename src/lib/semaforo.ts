export type Semaforo = 'verde' | 'amarelo' | 'vermelho' | 'indisponivel';

/**
 * Semáforo "vale a pena publicar?" (ADR-0020). `liquido` = preço − comissão ML;
 * `piso` = PRECO (líquido mínimo desejado); `custo` = CUSTO (null = sem dado).
 */
export function calcularSemaforo(
  liquido: number | null,
  piso: number,
  custo: number | null,
): Semaforo {
  if (liquido == null) return 'indisponivel';
  if (liquido >= piso) return 'verde';
  if (custo != null && custo > 0 && liquido < custo) return 'vermelho';
  return 'amarelo';
}

/** Acima de ~R$ 19 o ML dá frete grátis por conta do vendedor (custo não exposto pela API). */
export function freteSobConta(preco: number): boolean {
  return preco > 19;
}
