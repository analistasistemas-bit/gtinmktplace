import { describe, it, expect } from 'vitest';
import {
  extrairNossaOferta, ofertasNaoLidas, parseComissao, parseOfertasProduto, parsePriceToWin,
  parseStatusAnuncios,
} from '../parse.ts';

// Fixtures espelham a resposta real provada em 2026-08-16 (plano Pulse v1, "Fatos empíricos"):
// /products/{id}/items → results[] com item_id, price, seller_id, listing_type_id,
// shipping.free_shipping, official_store_id. sold_quantity/available_quantity vêm null.

describe('parseOfertasProduto', () => {
  it('exclui a nossa própria oferta (não somos concorrentes de nós mesmos)', () => {
    const json = {
      results: [
        { item_id: 'MLB1', price: 50, seller_id: 111, listing_type_id: 'gold_special', shipping: { free_shipping: true }, official_store_id: null },
        { item_id: 'MLB2', price: 60, seller_id: 222, listing_type_id: 'gold_special', shipping: { free_shipping: false }, official_store_id: null },
      ],
    };
    expect(parseOfertasProduto(json, 111).map((o) => o.item_id)).toEqual(['MLB2']);
    // Sem seller próprio (conexão sem conta_externa_id) nada é filtrado.
    expect(parseOfertasProduto(json, null)).toHaveLength(2);
    // conta_externa_id não-numérico vira NaN e também não filtra nada.
    expect(parseOfertasProduto(json, Number('abc'))).toHaveLength(2);
  });

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

describe('extrairNossaOferta', () => {
  const ficha = (results: unknown[]) => ({ results, paging: { total: results.length } });

  it('acha a nossa oferta na mesma resposta das concorrentes', () => {
    const json = ficha([
      { item_id: 'MLB111', seller_id: 999, price: 44.9 },
      { item_id: 'MLB222', seller_id: 9757132, price: 48.9 },
    ]);
    expect(extrairNossaOferta(json, 9757132)).toEqual({ item_id: 'MLB222', preco: 48.9 });
  });

  it('anúncio publicado por faixa: vence o MENOR preço nosso (o comparável com o menor rival)', () => {
    const json = ficha([
      { item_id: 'MLB_a', seller_id: 42, price: 90 },
      { item_id: 'MLB_b', seller_id: 42, price: 70 },
      { item_id: 'MLB_c', seller_id: 42, price: 110 },
    ]);
    expect(extrairNossaOferta(json, 42)).toEqual({ item_id: 'MLB_b', preco: 70 });
  });

  it('sem oferta nossa na ficha → null (anúncio pausado ou sem vínculo), nunca preço de outro', () => {
    const json = ficha([{ item_id: 'MLB111', seller_id: 999, price: 44.9 }]);
    expect(extrairNossaOferta(json, 42)).toBeNull();
  });

  it('sem conta externa conhecida não elege oferta nenhuma como nossa', () => {
    const json = ficha([{ item_id: 'MLB111', seller_id: 999, price: 44.9 }]);
    expect(extrairNossaOferta(json, null)).toBeNull();
    expect(extrairNossaOferta(json, undefined)).toBeNull();
  });

  it('resposta inválida não vira preço', () => {
    expect(extrairNossaOferta(null, 42)).toBeNull();
    expect(extrairNossaOferta({}, 42)).toBeNull();
  });
});

describe('ofertasNaoLidas', () => {
  it('conta o que ficou fora da página lida', () => {
    expect(ofertasNaoLidas({ results: new Array(100).fill({}), paging: { total: 137 } })).toBe(37);
  });

  it('ficha inteira lida → 0', () => {
    expect(ofertasNaoLidas({ results: [{}, {}], paging: { total: 2 } })).toBe(0);
  });

  it('sem paging não inventa excedente', () => {
    expect(ofertasNaoLidas({ results: [{}] })).toBe(0);
    expect(ofertasNaoLidas(null)).toBe(0);
  });
});

describe('parseStatusAnuncios', () => {
  it('extrai situação e o que a consulta de comissão precisa (categoria, tipo, preço)', () => {
    const json = [
      { code: 200, body: { id: 'MLB1', status: 'paused', sub_status: ['out_of_stock'], category_id: 'MLB1', listing_type_id: 'gold_special', price: 39.9 } },
      { code: 200, body: { id: 'MLB2', status: 'active', sub_status: [] } },
    ];
    expect(parseStatusAnuncios(json)).toEqual([
      { item_id: 'MLB1', status: 'paused', sub_status: ['out_of_stock'], category_id: 'MLB1', listing_type_id: 'gold_special', price: 39.9 },
      { item_id: 'MLB2', status: 'active', sub_status: [], category_id: null, listing_type_id: null, price: null },
    ]);
  });

  // Um id inválido volta com code de erro no meio dos que deram certo — descartar o lote inteiro
  // apagaria a situação de todos os outros anúncios daquela chamada.
  it('um item com erro não derruba os demais do lote', () => {
    const json = [
      { code: 404, body: { message: 'not found' } },
      { code: 200, body: { id: 'MLB2', status: 'active', sub_status: [] } },
    ];
    expect(parseStatusAnuncios(json).map((s) => s.item_id)).toEqual(['MLB2']);
  });

  it('resposta fora do formato não vira lista de situações', () => {
    expect(parseStatusAnuncios(null)).toEqual([]);
    expect(parseStatusAnuncios({ results: [] })).toEqual([]);
  });
});

describe('parseComissao', () => {
  it('guarda percentual e parcela fixa, não o valor pronto', () => {
    const json = { sale_fee_amount: 5.59, sale_fee_details: { percentage_fee: 14, fixed_fee: 0, gross_amount: 5.59 } };
    expect(parseComissao(json)).toEqual({ pct: 14, fixa: 0 });
  });

  it('parcela fixa em preço baixo não é descartada', () => {
    const json = { sale_fee_details: { percentage_fee: 14, fixed_fee: 4.99 } };
    expect(parseComissao(json)).toEqual({ pct: 14, fixa: 4.99 });
  });

  it('sem percentual não devolve estrutura — margem prefere faltar a errar', () => {
    expect(parseComissao({ sale_fee_amount: 5.59 })).toBeNull();
    expect(parseComissao(null)).toBeNull();
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
    const json = { status: 'no_benchmark_lowest', suggested_price: { amount: 10 } };
    expect(parsePriceToWin(json)).toEqual({ status: 'no_benchmark_lowest', preco_sugerido: 10, custos: null });
  });
});
