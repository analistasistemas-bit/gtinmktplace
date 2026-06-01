import { describe, it, expect } from 'vitest';
import { agregarMercado, posicaoNoRanking } from '../mercado-agregar';

describe('agregarMercado', () => {
  it('conta líderes e pega a maior reputação de vendas', () => {
    const r = agregarMercado([
      { lider: true, vendas: 52665 },
      { lider: false, vendas: 3644 },
      { lider: true, vendas: 25853 },
    ]);
    expect(r).toEqual({ lideres: 2, maior_vendas: 52665 });
  });
  it('lista vazia → zeros', () => {
    expect(agregarMercado([])).toEqual({ lideres: 0, maior_vendas: 0 });
  });
});

describe('posicaoNoRanking', () => {
  const json = { content: [
    { id: 'MLBU1', position: 1, type: 'USER_PRODUCT' },
    { id: 'MLB38054475', position: 2, type: 'PRODUCT' },
    { id: 'MLB34175726', position: 7, type: 'PRODUCT' },
  ]};
  it('acha a posição do produto', () => {
    expect(posicaoNoRanking(json, 'MLB34175726')).toBe(7);
  });
  it('produto fora do ranking → null', () => {
    expect(posicaoNoRanking(json, 'MLB999')).toBe(null);
  });
  it('payload inválido → null', () => {
    expect(posicaoNoRanking(null, 'MLB1')).toBe(null);
    expect(posicaoNoRanking({}, 'MLB1')).toBe(null);
  });
});
