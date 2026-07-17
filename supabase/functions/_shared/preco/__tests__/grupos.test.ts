import { describe, it, expect } from 'vitest';
import { round2, precoCentavos, precosDivergentes, garantirPrecoUniforme } from '../grupos';

describe('precoCentavos', () => {
  it('converte para centavos inteiros com arredondamento a 2 casas', () => {
    expect(precoCentavos(12.346)).toBe(1235); // round2 primeiro (12.35)
    expect(precoCentavos('10.10')).toBe(1010); // numeric do PG chega como string
    expect(precoCentavos(0.1 + 0.2)).toBe(30); // sem lixo de float
  });
  it('null/undefined/NaN → null', () => {
    expect(precoCentavos(null)).toBeNull();
    expect(precoCentavos(undefined)).toBeNull();
    expect(precoCentavos('abc')).toBeNull();
  });
});

describe('round2', () => {
  it('arredonda a 2 casas', () => {
    expect(round2(12.346)).toBe(12.35);
  });
});

describe('precosDivergentes', () => {
  it('uniforme → false (caracterização: 32/32 famílias hoje)', () => {
    expect(precosDivergentes([
      { preco_publicacao: 10 }, { preco_publicacao: '10.00' }, { preco_publicacao: 10.0 },
    ])).toBe(false);
  });
  it('2 preços → true', () => {
    expect(precosDivergentes([{ preco_publicacao: 10 }, { preco_publicacao: 12 }])).toBe(true);
  });
  it('nulos são ignorados (herdam o preço do anúncio, como hoje)', () => {
    expect(precosDivergentes([{ preco_publicacao: 10 }, { preco_publicacao: null }])).toBe(false);
    expect(precosDivergentes([{ preco_publicacao: null }])).toBe(false);
  });
  it('diferença de menos de 1 centavo NÃO diverge (comparação por centavos)', () => {
    expect(precosDivergentes([{ preco_publicacao: 10.001 }, { preco_publicacao: 10.004 }])).toBe(false);
  });
});

describe('garantirPrecoUniforme', () => {
  it('uniforme → não lança', () => {
    expect(() => garantirPrecoUniforme(
      [{ codigo: 'A', preco_publicacao: 10 }, { codigo: 'B', preco_publicacao: 10 }], 'CREATE',
    )).not.toThrow();
  });
  it('divergente → LOUD com status 400 (definitivo, QStash não retenta)', () => {
    try {
      garantirPrecoUniforme(
        [{ codigo: 'A', preco_publicacao: 10 }, { codigo: 'B', preco_publicacao: 12 }], 'UPDATE',
      );
      throw new Error('deveria ter lançado');
    } catch (e) {
      expect((e as Error).message).toContain('UPDATE');
      expect((e as Error).message).toContain('split');
      expect((e as Error & { status?: number }).status).toBe(400);
    }
  });
});
