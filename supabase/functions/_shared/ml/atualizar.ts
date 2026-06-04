export interface MLVariacaoAtual {
  id: string | number;
  seller_custom_field?: string | null;
  available_quantity: number;
}
export interface EstoqueDesejado { codigo: string; estoque: number; }
export interface VariacaoUpdate { id: string | number; available_quantity: number; }

// Reenvia TODAS as variações atuais do anúncio (o ML deleta as omitidas). Só
// available_quantity — sem price, para o ML preservar o preço de venda.
export function montarVariacoesUpdate(
  atuais: MLVariacaoAtual[],
  desejados: EstoqueDesejado[],
): VariacaoUpdate[] {
  const estoquePorCodigo = new Map(desejados.map((d) => [d.codigo, d.estoque]));
  return atuais.map((a) => {
    const codigo = a.seller_custom_field ?? '';
    const novo = estoquePorCodigo.get(codigo);
    return { id: a.id, available_quantity: novo ?? a.available_quantity };
  });
}
