// ADR-0078 F2: faixa de preço = variações com o mesmo preço, comparado por CENTAVOS INTEIROS
// (arredondamento a 2 casas antes de agrupar — glossário do spec).

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Preço em centavos inteiros (chave de faixa). null/NaN → null. Aceita string (numeric do PG). */
export function precoCentavos(preco: number | string | null | undefined): number | null {
  if (preco == null) return null;
  const n = Number(preco);
  if (!Number.isFinite(n)) return null;
  return Math.round(round2(n) * 100);
}

/** >1 preço distinto entre os NÃO-nulos. Nulos herdam o preço do anúncio (como hoje) e não divergem. */
export function precosDivergentes(
  variacoes: Array<{ preco_publicacao: number | string | null }>,
): boolean {
  const distintos = new Set(
    variacoes.map((v) => precoCentavos(v.preco_publicacao)).filter((c): c is number => c != null),
  );
  return distintos.size > 1;
}

/** Guard dos workers de anúncio único (publish/update-familia-ml): divergência aqui é bug de
 *  roteamento — publicar colapsando seria preço errado em silêncio. LOUD, nada é enviado. */
export function garantirPrecoUniforme(
  variacoes: Array<{ codigo: string; preco_publicacao: number | string | null }>,
  contexto: string,
): void {
  if (!precosDivergentes(variacoes)) return;
  const e = new Error(
    `${contexto}: preços divergentes entre as variações — este worker publica preço único; ` +
    `a publicação deveria ter roteado para o split por faixa (publicar-split-ml). Nada foi enviado (400)`,
  ) as Error & { status?: number };
  e.status = 400;
  throw e;
}
