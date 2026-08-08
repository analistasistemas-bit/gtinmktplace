/**
 * Chave de cache de concorrência por GTIN, centralizada (spike 037, §7.3/T3): o literal
 * `gtin:v3:` aparecia em 3 call sites de `ml/concorrencia.ts` (GET, tombstone, SET) — um bump
 * parcial deixaria leitura e escrita em versões diferentes, envenenando o cache em silêncio.
 * Módulo puro, sem imports — por isso não vai em `redis/`, que puxa o client.
 * v4: campo `descricao_catalogo` (T2) passa a entrar no payload cacheado.
 */
export function chaveCacheGtin(gtin: string): string {
  return `gtin:v4:${gtin}`;
}
