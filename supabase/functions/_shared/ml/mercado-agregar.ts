export interface ReputacaoVendedor {
  lider: boolean;
  vendas: number;
}

export function agregarMercado(reps: ReputacaoVendedor[]): { lideres: number; maior_vendas: number } {
  return {
    lideres: reps.filter((r) => r.lider).length,
    maior_vendas: reps.reduce((max, r) => Math.max(max, r.vendas), 0),
  };
}

export function posicaoNoRanking(json: unknown, productId: string): number | null {
  const content = (json as { content?: Array<{ id?: string; position?: number }> } | null)?.content;
  if (!Array.isArray(content)) return null;
  const achado = content.find((c) => c.id === productId);
  return typeof achado?.position === 'number' ? achado.position : null;
}
