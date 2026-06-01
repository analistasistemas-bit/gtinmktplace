import { describe, it, expect } from 'vitest';
import { parseProdutoBusca, parseItensProduto } from '../parse';

describe('parseProdutoBusca', () => {
  it('payload vazio/inválido → null', () => {
    expect(parseProdutoBusca({ results: [] })).toBe(null);
    expect(parseProdutoBusca({})).toBe(null);
    expect(parseProdutoBusca(null)).toBe(null);
  });

  it('extrai o id do 1º produto de catálogo', () => {
    const json = {
      paging: { total: 1 },
      results: [
        { id: 'MLB34175726', name: 'Fita De Cetim 15mm Progresso N°03' },
        { id: 'MLB99999999', name: 'outro' },
      ],
    };
    expect(parseProdutoBusca(json)).toBe('MLB34175726');
  });

  it('id ausente no 1º resultado → null', () => {
    expect(parseProdutoBusca({ results: [{ name: 'sem id' }] })).toBe(null);
  });
});

describe('parseItensProduto', () => {
  it('payload vazio → 0 vendedores, preço null', () => {
    expect(parseItensProduto({ results: [] })).toEqual({ vendedores: 0, preco_min: null });
    expect(parseItensProduto({})).toEqual({ vendedores: 0, preco_min: null });
    expect(parseItensProduto(null)).toEqual({ vendedores: 0, preco_min: null });
  });

  it('conta vendedores distintos (seller_id) e pega o menor preço', () => {
    // formato real de /products/{id}/items
    const json = {
      paging: { total: 8 },
      results: [
        { seller_id: 303221310, price: 12.62 },
        { seller_id: 146443982, price: 13.35 },
        { seller_id: 303221310, price: 11.0 }, // mesmo seller → conta 1
      ],
    };
    expect(parseItensProduto(json)).toEqual({ vendedores: 2, preco_min: 11.0 });
  });

  it('ignora preços inválidos (<=0 ou ausentes)', () => {
    const json = {
      results: [
        { seller_id: 1, price: 0 },
        { seller_id: 2, price: 5.25 },
        { seller_id: 3 },
      ],
    };
    expect(parseItensProduto(json)).toEqual({ vendedores: 3, preco_min: 5.25 });
  });

  it('sem seller_id usa o nº de ofertas como fallback de contagem', () => {
    const json = { results: [{ price: 3 }, { price: 4 }] };
    expect(parseItensProduto(json)).toEqual({ vendedores: 2, preco_min: 3 });
  });

  it('mesmo vendedor com id number e string conta como 1', () => {
    const json = { results: [
      { seller_id: 1, price: 5 },
      { seller_id: '1', price: 6 },
    ]};
    expect(parseItensProduto(json)).toEqual({ vendedores: 1, preco_min: 5 });
  });
});
