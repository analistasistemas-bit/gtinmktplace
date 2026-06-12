const API = 'https://api.mercadolibre.com';
const TIMEOUT_MS = 15000;

/** Extrai `category_id` da resposta de `/products/{id}`. null se ausente/vazio. */
export function parseCategoriaProduto(json: unknown): string | null {
  const cat = (json as { category_id?: string } | null)?.category_id;
  return typeof cat === 'string' && cat.length > 0 ? cat : null;
}

/** GET /products/{id} → category_id. null em erro HTTP/timeout (resiliente). */
export async function buscarCategoriaProduto(
  token: string,
  productId: string,
): Promise<string | null> {
  try {
    const resp = await fetch(`${API}/products/${productId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    return parseCategoriaProduto(await resp.json());
  } catch {
    return null;
  }
}
