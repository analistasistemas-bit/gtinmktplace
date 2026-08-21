/**
 * Chave de cache de concorrência por GTIN, centralizada (spike 037, §7.3/T3): o literal
 * `gtin:v3:` aparecia em 3 call sites de `ml/concorrencia.ts` (GET, tombstone, SET) — um bump
 * parcial deixaria leitura e escrita em versões diferentes, envenenando o cache em silêncio.
 * Módulo puro, sem imports — por isso não vai em `redis/`, que puxa o client.
 * v5: detalhes de oferta agora precisam de `item_id`, `frete_gratis` e `full` para a
 * qualificação da Viabilidade; a versão nova força refetch de payloads v4 incompletos.
 */
export function chaveCacheGtin(gtin: string): string {
  return `gtin:v5:${gtin}`;
}
