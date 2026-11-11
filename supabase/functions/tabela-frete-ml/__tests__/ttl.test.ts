import { describe, expect, it } from 'vitest';
import { CHAVE_CACHE_PREFIXO, ttlTabelaFrete } from '../ttl';

describe('ttlTabelaFrete', () => {
  it('célula indisponível (null) → 300 s', () => {
    expect(ttlTabelaFrete({ celulas: [[1, null], [2, 3]] })).toBe(300);
  });
  it('completa (inclui 0) → 24 h', () => {
    expect(ttlTabelaFrete({ celulas: [[0, 1], [2, 3]] })).toBe(24 * 60 * 60);
  });
  it('chave versionada v2', () => {
    expect(CHAVE_CACHE_PREFIXO).toBe('tabela-frete:v2:');
  });
});
