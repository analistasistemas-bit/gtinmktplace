/** Extrai o product_id (catálogo) do 1º resultado de `/products/search`. null se vazio. */
export function parseProdutoBusca(json: unknown): string | null {
  const results = (json as { results?: Array<{ id?: string }> } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const id = results[0]?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

interface MLItem {
  seller_id?: number | string;
  price?: number;
}

/**
 * Conta vendedores distintos e o menor preço das ofertas de `/products/{id}/items`.
 * Estrutura real: `{ results: [{ seller_id, price }] }` (campos no topo, não em `seller.id`).
 */
export function parseItensProduto(
  json: unknown,
): { vendedores: number; preco_min: number | null } {
  const results = (json as { results?: MLItem[] } | null)?.results;
  if (!Array.isArray(results) || results.length === 0) {
    return { vendedores: 0, preco_min: null };
  }
  const precos = results
    .map((r) => r.price)
    .filter((p): p is number => typeof p === 'number' && p > 0);
  const sellers = new Set(
    results
      .map((r) => (r.seller_id != null ? String(r.seller_id) : undefined))
      .filter((id): id is string => id !== undefined),
  );
  return {
    vendedores: sellers.size > 0 ? sellers.size : results.length,
    preco_min: precos.length ? precos.reduce((a, b) => Math.min(a, b)) : null,
  };
}
