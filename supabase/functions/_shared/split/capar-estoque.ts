// Cap de estoque por teto (ADR-0048). O Mercado Livre rejeita anúncios cuja soma de
// available_quantity das variações passa de 99.999 (reference_ml_limites_anuncio). Em vez de
// falsear estoque uniformemente, acha o maior teto T tal que sum(min(estoque, T)) <= LIMITE:
// cores com pouco estoque mostram o número real; só as de maior estoque são capadas em T.
// Idempotente e estável; o estoque real continua intacto no banco (só o enviado ao ML é capado).

export interface ItemEstoque {
  sku: string;
  estoque: number;
}

export const LIMITE_ESTOQUE_ML = 99999;

export function caparEstoque(itens: ItemEstoque[], limite = LIMITE_ESTOQUE_ML): Map<string, number> {
  const soma = itens.reduce((s, i) => s + Math.max(0, i.estoque), 0);
  if (soma <= limite) {
    return new Map(itens.map((i) => [i.sku, Math.max(0, i.estoque)]));
  }
  const somaCom = (t: number) => itens.reduce((s, i) => s + Math.min(Math.max(0, i.estoque), t), 0);
  // Maior teto T com somaCom(T) <= limite (somaCom é monotônica crescente em T).
  let lo = 0;
  let hi = Math.max(...itens.map((i) => Math.max(0, i.estoque)));
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (somaCom(mid) <= limite) lo = mid;
    else hi = mid - 1;
  }
  return new Map(itens.map((i) => [i.sku, Math.min(Math.max(0, i.estoque), lo)]));
}
