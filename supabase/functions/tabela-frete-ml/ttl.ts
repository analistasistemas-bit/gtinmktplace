export const CHAVE_CACHE_PREFIXO = 'tabela-frete:v2:';

const TTL_COMPLETA_S = 24 * 60 * 60;
const TTL_INCOMPLETA_S = 300; // faixa que o ML não respondeu não pode congelar por 24h

export function ttlTabelaFrete(t: { celulas: (number | null)[][] }): number {
  return t.celulas.some((l) => l.some((c) => c === null)) ? TTL_INCOMPLETA_S : TTL_COMPLETA_S;
}
