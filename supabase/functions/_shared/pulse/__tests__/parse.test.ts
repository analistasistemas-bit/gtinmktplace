import { describe, it, expect } from 'vitest';
import { parseOfertasProduto, parsePriceToWin } from '../parse.ts';

// Fixtures espelham a resposta real provada em 2026-08-16 (plano Pulse v1, "Fatos empíricos"):
// /products/{id}/items → results[] com item_id, price, seller_id, listing_type_id,
// shipping.free_shipping, official_store_id. sold_quantity/available_quantity vêm null.

describe('parseOfertasProduto', () => {
  it('extrai ofertas do shape real de /products/{id}/items', () => {
    const json = {
      results: [
        {
          item_id: 'MLB123456789',
          price: 99.9,
          sold_quantity: null,
          available_quantity: null,
          seller_id: 111222333,
          listing_type_id: 'gold_special',
          shipping: { free_shipping: true },
          official_store_id: null,
        },
        {
          item_id: 'MLB987654321',
          price: 105,
          sold_quantity: null,
          available_quantity: null,
          seller_id: 444555666,
          listing_type_id: 'gold_pro',
          shipping: { free_shipping: false },
          official_store_id: 42,
        },
      ],
    };
    expect(parseOfertasProduto(json)).toEqual([
      {
        item_id: 'MLB123456789',
        seller_id: 111222333,
        preco: 99.9,
        tier: 'gold_special',
        frete_gratis: true,
        loja_oficial: false,
      },
      {
        item_id: 'MLB987654321',
        seller_id: 444555666,
        preco: 105,
        tier: 'gold_pro',
        frete_gratis: false,
        loja_oficial: true,
      },
    ]);
  });

  it('ignora oferta sem price', () => {
    const json = {
      results: [
        { item_id: 'MLB1', seller_id: 1, listing_type_id: 'gold_special', shipping: { free_shipping: true } },
        { item_id: 'MLB2', price: 50, seller_id: 2, listing_type_id: 'gold_special', shipping: { free_shipping: false } },
      ],
    };
    expect(parseOfertasProduto(json)).toEqual([
      { item_id: 'MLB2', seller_id: 2, preco: 50, tier: 'gold_special', frete_gratis: false, loja_oficial: false },
    ]);
  });

  it('sem results[] → []', () => {
    expect(parseOfertasProduto({})).toEqual([]);
    expect(parseOfertasProduto(null)).toEqual([]);
  });
});

describe('parsePriceToWin', () => {
  it('extrai status/preco_sugerido/custos de /suggestions/items/{id}/details', () => {
    const json = {
      status: 'with_benchmark_highest',
      suggested_price: { amount: 89.9 },
      costs: { selling_fees: 3.78, shipping_fees: 6.65 },
    };
    expect(parsePriceToWin(json)).toEqual({
      status: 'with_benchmark_highest',
      preco_sugerido: 89.9,
      custos: { comissao: 3.78, frete: 6.65 },
    });
  });

  it('sem status → null', () => {
    expect(parsePriceToWin({})).toBeNull();
    expect(parsePriceToWin(null)).toBeNull();
  });

  it('sem costs → custos null', () => {
    const json = { status: 'no_benchmark', suggested_price: { amount: 10 } };
    expect(parsePriceToWin(json)).toEqual({ status: 'no_benchmark', preco_sugerido: 10, custos: null });
  });
});
