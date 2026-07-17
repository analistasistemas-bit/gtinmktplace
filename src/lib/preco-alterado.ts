const round2 = (n: number) => Math.round(n * 100) / 100;

interface VariacaoPreco {
  precoPublicacao: number | null;
  precoPublicadoMl: number | null;
  excluidaDaPublicacao: boolean;
}

/** F2 (ADR-0078): badge POR VARIAÇÃO — o preço que o publish empurraria (o da própria
 *  variação) difere do último confirmado no ML. precoPublicadoMl null = nunca publicada. */
export function temAlteracaoPreco(familia: { variacoes: VariacaoPreco[] }): boolean {
  return familia.variacoes.some(
    (v) =>
      !v.excluidaDaPublicacao &&
      v.precoPublicacao != null &&
      v.precoPublicadoMl != null &&
      round2(v.precoPublicacao) !== round2(v.precoPublicadoMl),
  );
}
