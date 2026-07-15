const round2 = (n: number) => Math.round(n * 100) / 100;

interface VariacaoPreco {
  precoPublicacao: number | null;
  precoPublicadoMl: number | null;
  excluidaDaPublicacao: boolean;
}

/** true se o preço efetivo colapsado da família (F1) diverge do último preço publicado no ML. */
export function temAlteracaoPreco(familia: { variacoes: VariacaoPreco[] }): boolean {
  const incluidas = familia.variacoes.filter((v) => !v.excluidaDaPublicacao);
  const efetivo = incluidas.find((v) => v.precoPublicacao != null)?.precoPublicacao ?? null;
  if (efetivo == null) return false;
  return incluidas.some((v) => v.precoPublicadoMl != null && round2(efetivo) !== round2(v.precoPublicadoMl));
}
