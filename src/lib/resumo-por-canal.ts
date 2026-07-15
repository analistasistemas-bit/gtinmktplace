/** Breakdown por canal para o Dashboard em "Todos" (spec S3). Só é exibido com >1 canal. */
export function liquidoPorCanal(
  vendas: Array<{ canal?: string; liquido: number }>,
): Array<{ canal: string; liquido: number; pedidos: number }> {
  const m = new Map<string, { liquido: number; pedidos: number }>();
  for (const v of vendas) {
    const c = v.canal ?? 'mercado_livre';
    const atual = m.get(c) ?? { liquido: 0, pedidos: 0 };
    atual.liquido += v.liquido;
    atual.pedidos += 1;
    m.set(c, atual);
  }
  return [...m.entries()]
    .map(([canal, agg]) => ({ canal, ...agg }))
    .sort((a, b) => b.liquido - a.liquido);
}
