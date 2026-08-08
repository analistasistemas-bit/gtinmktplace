import { describe, it, expect } from 'vitest';
import { chaveCacheGtin } from '../cache-chave';

describe('chaveCacheGtin', () => {
  it('monta o termo com a versão vigente v4', () => {
    expect(chaveCacheGtin('7908615000244')).toBe('gtin:v4:7908615000244');
  });
});
