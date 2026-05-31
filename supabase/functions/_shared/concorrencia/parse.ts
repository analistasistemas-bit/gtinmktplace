interface MLSearchResult {
  price?: number;
  seller?: { id?: number | string };
}

export function parseResultadoBusca(json: unknown): { vendedores: number; preco_min: number | null } {
  const results = (json as { results?: MLSearchResult[] } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) {
    return { vendedores: 0, preco_min: null };
  }
  const precos = results
    .map((r) => r.price)
    .filter((p): p is number => typeof p === 'number' && p > 0);
  const sellers = new Set(
    results.map((r) => r.seller?.id).filter((id) => id !== undefined && id !== null),
  );
  return {
    vendedores: sellers.size > 0 ? sellers.size : results.length,
    preco_min: precos.length ? Math.min(...precos) : null,
  };
}
