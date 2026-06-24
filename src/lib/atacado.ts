export interface FaixaAtacado {
  min_unidades: number;
  desconto_pct: number;
}

export const MAX_FAIXAS = 5;

/** Valor absoluto a partir do preço-base e do % de desconto. Arredonda a 2 casas. */
export function amountComDesconto(precoBase: number, pct: number): number {
  return Math.round(precoBase * (1 - pct / 100) * 100) / 100;
}

/** Valida o conjunto de faixas. Retorna null se ok, ou a mensagem do 1º erro. */
export function validarFaixas(faixas: FaixaAtacado[]): string | null {
  if (faixas.length === 0) return null;
  if (faixas.length > MAX_FAIXAS) return `Máximo de ${MAX_FAIXAS} faixas.`;
  const ord = [...faixas].sort((a, b) => a.min_unidades - b.min_unidades);
  for (let i = 0; i < ord.length; i++) {
    const f = ord[i];
    if (!Number.isInteger(f.min_unidades) || f.min_unidades < 2) return 'Mínimo de unidades deve ser inteiro ≥ 2.';
    if (f.desconto_pct <= 0 || f.desconto_pct >= 100) return 'Desconto deve ser entre 1% e 99%.';
    if (i > 0) {
      if (ord[i].min_unidades === ord[i - 1].min_unidades) return 'Quantidades mínimas não podem repetir.';
      if (ord[i].desconto_pct <= ord[i - 1].desconto_pct) return 'Mais unidades deve dar mais desconto.';
    }
  }
  return null;
}
