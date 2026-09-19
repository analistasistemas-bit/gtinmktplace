import { describe, expect, it } from 'vitest';
import { sanearTiposProduto } from '../tipos-produto.ts';

describe('sanearTiposProduto', () => {
  it('lista vazia e estado valido — nao ha tipo obrigatorio', () => {
    expect(sanearTiposProduto([])).toEqual([]);
  });

  it('aceita os dois juntos (combinavel, nao exclusivo)', () => {
    expect(sanearTiposProduto(['roupa', 'calcado'])).toEqual(['roupa', 'calcado']);
  });

  it('descarta valor fora da whitelist', () => {
    expect(sanearTiposProduto(['roupa', 'movel', 'calcado'])).toEqual(['roupa', 'calcado']);
  });

  it('deduplica', () => {
    expect(sanearTiposProduto(['roupa', 'roupa'])).toEqual(['roupa']);
  });

  it('corpo que nao e array vira lista vazia, nunca lanca', () => {
    expect(sanearTiposProduto(undefined)).toEqual([]);
    expect(sanearTiposProduto('roupa')).toEqual([]);
    expect(sanearTiposProduto(null)).toEqual([]);
  });

  it('ordem de saida e sempre a canonica, nao a do payload', () => {
    expect(sanearTiposProduto(['calcado', 'roupa'])).toEqual(['roupa', 'calcado']);
  });
});
