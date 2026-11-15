// Parte pura da capa do kit virtual (sem import, sem Deno): usada pela edge e pelo front (mesma regra nos dois lados).

/** rotulo = título do componente (≤ 80 chars, limpo pela edge). */
export type ItemComposicao = { rotulo: string; quantidade: number };

export const MAX_UNIDADES_CAPA = 6;

/** Σquantidade ≤ 6 → mostra todas as unidades; acima, uma de cada produto. */
export function modoCapa(itens: ItemComposicao[]): 'todas' | 'uma_de_cada' {
  return itens.reduce((s, i) => s + i.quantidade, 0) <= MAX_UNIDADES_CAPA ? 'todas' : 'uma_de_cada';
}

/** Quantas unidades de cada produto aparecem na capa. */
export function quantidadesNaCapa(itens: ItemComposicao[]): number[] {
  return modoCapa(itens) === 'todas' ? itens.map((i) => i.quantidade) : itens.map(() => 1);
}

/** Chave do teto de gerações: user_product_ids únicos e ordenados, sem quantidades. */
export function chaveComposicao(userProductIds: string[]): string {
  return [...new Set(userProductIds)].sort().join('|');
}
