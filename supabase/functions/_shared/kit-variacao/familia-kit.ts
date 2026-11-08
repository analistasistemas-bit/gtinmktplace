// ADR-0200: a família do kit com variação nasce com `kit_variacao_pedido` (hash do pedido, gravado
// junto da família em criar-kit-variacao). É a marca que as travas de reprocessamento usam, porque
// `kit_multiplicador` só identifica o kit vinculado (ADR-0151).
export function ehFamiliaDeKit(f: { kit_multiplicador?: unknown; kit_variacao_pedido?: unknown }): boolean {
  return f.kit_multiplicador != null || f.kit_variacao_pedido != null;
}
