import { describe, it, expect } from 'vitest';
import { parseProdutoBusca, parseNomeProdutoBusca, parseItensProduto } from '../parse';

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

describe('parseNomeProdutoBusca', () => {
  it('extrai o name do 1º produto de catálogo', () => {
    expect(parseNomeProdutoBusca({ results: [{ id: 'MLB26209871', name: 'Fita Cetim Progresso Amarelo Ouro 7mm x 100m' }] }))
      .toBe('Fita Cetim Progresso Amarelo Ouro 7mm x 100m');
  });
  it('name ausente/vazio ou payload vazio → null', () => {
    expect(parseNomeProdutoBusca({ results: [{ id: 'MLB1' }] })).toBeNull();
    expect(parseNomeProdutoBusca({ results: [{ id: 'MLB1', name: '' }] })).toBeNull();
    expect(parseNomeProdutoBusca({ results: [] })).toBeNull();
    expect(parseNomeProdutoBusca(null)).toBeNull();
  });
});

describe('parseItensProduto', () => {
  const json = {
    paging: { total: 4 },
    results: [
      { seller_id: 1, price: 12.62, category_id: 'MLB255054', shipping: { free_shipping: true, logistic_type: 'fulfillment' } },
      { seller_id: 2, price: 17.02, category_id: 'MLB255054', shipping: { free_shipping: false, logistic_type: 'cross_docking' } },
      { seller_id: 1, price: 14.0, shipping: { free_shipping: true, logistic_type: 'drop_off' } },
      { seller_id: 3, price: 0, shipping: { free_shipping: false, logistic_type: 'cross_docking' } },
    ],
  };

  it('payload vazio → tudo zerado', () => {
    expect(parseItensProduto({ results: [] })).toEqual({
      vendedores: 0, preco_min: null, preco_max: null, total_ofertas: 0,
      frete_gratis: 0, full: 0, seller_ids: [], category_id: null,
    });
    expect(parseItensProduto(null)).toEqual({
      vendedores: 0, preco_min: null, preco_max: null, total_ofertas: 0,
      frete_gratis: 0, full: 0, seller_ids: [], category_id: null,
    });
  });

  it('extrai category_id da 1ª oferta que tiver (GET /products/{id} não traz esse campo)', () => {
    expect(parseItensProduto(json).category_id).toBe('MLB255054');
    expect(parseItensProduto({ results: [{ seller_id: 9, price: 5 }] }).category_id).toBeNull();
  });

  it('preço min/max ignora <=0; total_ofertas conta todas', () => {
    const r = parseItensProduto(json);
    expect(r.preco_min).toBe(12.62);
    expect(r.preco_max).toBe(17.02);
    expect(r.total_ofertas).toBe(4);
  });

  it('vendedores distintos e seller_ids únicos', () => {
    const r = parseItensProduto(json);
    expect(r.vendedores).toBe(3);
    expect(r.seller_ids.sort()).toEqual([1, 2, 3]);
  });

  it('conta frete grátis e FULL por oferta', () => {
    const r = parseItensProduto(json);
    expect(r.frete_gratis).toBe(2);
    expect(r.full).toBe(1);
  });
});
