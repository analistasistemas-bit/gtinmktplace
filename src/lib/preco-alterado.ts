const round2 = (n: number) => Math.round(n * 100) / 100;

interface VariacaoPreco {
  precoPublicacao: number | null;
  precoPublicadoMl: number | null;
  excluidaDaPublicacao: boolean;
}

/** F2 (ADR-0078): badge POR VARIAÇÃO — o preço que o publish empurraria (o da própria
 *  variação) difere do último confirmado no ML. precoPublicadoMl null = nunca publicada.
 *  Família já publicada não tem preço pendente: a escolha foi feita, e "somente estoque" deixa a
 *  divergência de propósito — o selo ali lia como "o preço mudou no ML", o que não aconteceu. */
export function temAlteracaoPreco(familia: { status?: string; variacoes: VariacaoPreco[] }): boolean {
  if (familia.status === 'publicado') return false;
  return familia.variacoes.some(
    (v) =>
      !v.excluidaDaPublicacao &&
      v.precoPublicacao != null &&
      v.precoPublicadoMl != null &&
      round2(v.precoPublicacao) !== round2(v.precoPublicadoMl),
  );
}
