import { describe, it, expect } from 'vitest';
import { parseResultadoBusca } from '../parse';

describe('parseResultadoBusca', () => {
  it('payload vazio → 0 vendedores, preço null', () => {
    expect(parseResultadoBusca({ results: [] })).toEqual({ vendedores: 0, preco_min: null });
    expect(parseResultadoBusca({})).toEqual({ vendedores: 0, preco_min: null });
    expect(parseResultadoBusca(null)).toEqual({ vendedores: 0, preco_min: null });
  });

  it('conta vendedores distintos e pega o menor preço', () => {
    const json = {
      results: [
        { price: 9.9, seller: { id: 1 } },
        { price: 7.5, seller: { id: 2 } },
        { price: 8.0, seller: { id: 1 } }, // mesmo seller 1
      ],
    };
    expect(parseResultadoBusca(json)).toEqual({ vendedores: 2, preco_min: 7.5 });
  });

  it('ignora preços inválidos (<=0 ou ausentes)', () => {
    const json = {
      results: [
        { price: 0, seller: { id: 1 } },
        { price: 5.25, seller: { id: 2 } },
        { seller: { id: 3 } },
      ],
    };
    expect(parseResultadoBusca(json)).toEqual({ vendedores: 3, preco_min: 5.25 });
  });

  it('sem seller.id usa o nº de resultados como fallback de contagem', () => {
    const json = { results: [{ price: 3 }, { price: 4 }] };
    expect(parseResultadoBusca(json)).toEqual({ vendedores: 2, preco_min: 3 });
  });

  it('mesmo vendedor com id number e string conta como 1', () => {
    const json = { results: [
      { price: 5, seller: { id: 1 } },
      { price: 6, seller: { id: '1' } },
    ]};
    expect(parseResultadoBusca(json)).toEqual({ vendedores: 1, preco_min: 5 });
  });
});
