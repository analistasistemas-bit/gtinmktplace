import { describe, expect, it } from 'vitest';
import { separarCanais } from '../selecao.ts';

describe('separarCanais', () => {
  it('default (undefined) -> só mercado_livre', () => {
    expect(separarCanais(undefined)).toEqual({ canaisSel: ['mercado_livre'], incluiML: true, extras: [] });
  });
  it('vazio -> default mercado_livre', () => {
    expect(separarCanais([])).toEqual({ canaisSel: ['mercado_livre'], incluiML: true, extras: [] });
  });
  it('ML + shopee -> incluiML true, extras [shopee]', () => {
    expect(separarCanais(['mercado_livre', 'shopee'])).toEqual({
      canaisSel: ['mercado_livre', 'shopee'], incluiML: true, extras: ['shopee'],
    });
  });
  it('só shopee -> incluiML false, extras [shopee]', () => {
    expect(separarCanais(['shopee'])).toEqual({ canaisSel: ['shopee'], incluiML: false, extras: ['shopee'] });
  });
});
