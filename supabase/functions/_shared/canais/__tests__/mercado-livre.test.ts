import { describe, it, expect, afterEach } from 'vitest';
import { mercadoLivreConnector } from '../mercado-livre';
import type { AtualizacaoCanonica } from '../contrato';

const globalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = globalFetch; });

const ctxFake = { getToken: () => Promise.resolve('tok') };

// GET (buscarItemML) devolve 1 variação viva; PUT (atualizarItemML) é capturado; 2º GET é o refetch.
function stubFetch(getBody: unknown) {
  let putBody: any = null;
  const okItem = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200 }));
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putBody = JSON.parse(init.body as string);
      return okItem({ variations: [] });
    }
    return okItem(getBody);
  }) as typeof fetch;
  return () => putBody;
}

describe('atualizarAnuncio somenteEstoque', () => {
  const baseGet = {
    id: 'MLB1',
    variations: [{ id: 1, seller_custom_field: 'A1', available_quantity: 9, price: 25, picture_ids: [], attribute_combinations: [{ id: 'COLOR', value_name: 'Azul' }] }],
    pictures: [],
  };
  const atualiz: AtualizacaoCanonica = {
    itemExternoId: 'MLB1',
    existentes: [{ sku: 'A1', estoque: 9, cor: 'Azul' }],
    novas: [{ sku: 'N1', cor: 'Rosa', estoque: 4, preco: 30, gtin: null, fotoId: 'P' }],
    capaFotoId: null, capa2FotoId: null, capa3FotoId: null, categoriaId: null,
    marca: null, dimensoes: null, desconto: null, precoFamilia: null,
    somenteEstoque: true,
  };

  it('nao empurra preco na existente e da preco vivo (25) a cor nova', async () => {
    const getPut = stubFetch(baseGet);
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, atualiz);
    expect(res.ok).toBe(true);
    const putBody = getPut();
    // A existente no PUT só carrega `id` (VariacaoUpdate) — casar por id; a cor nova carrega seller_custom_field.
    expect(putBody.variations.find((v: any) => v.seller_custom_field === 'N1').price).toBe(25);
    expect(putBody.variations.find((v: any) => v.id === 1).price).toBeUndefined();
    // precoVivo do GET propagado no resultado (consumido pela Task 7).
    expect(res.valor?.precoVivo).toBe(25);
  });
});

describe('atualizarAnuncio em item plano (ADR-0084)', () => {
  it('GET sem variations + 1 existente → PUT plano direto no corpo raiz (price/available_quantity), sem variations', async () => {
    let putBody: any = null;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putBody = JSON.parse(init.body as string);
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 'MLB1', variations: [], pictures: [], price: 100, available_quantity: 10 }), { status: 200 }));
    }) as typeof fetch;
    const atualiz: AtualizacaoCanonica = {
      itemExternoId: 'MLB1',
      existentes: [{ sku: 'A1', estoque: 15, cor: 'Prata' }],
      novas: [],
      capaFotoId: null, capa2FotoId: null, capa3FotoId: null, categoriaId: null,
      marca: null, dimensoes: null, desconto: null, precoFamilia: 130,
      somenteEstoque: false,
    };
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, atualiz);
    expect(res.ok).toBe(true);
    expect(putBody).toEqual({ available_quantity: 15, price: 130 });
    expect(res.valor?.variacoesExternas).toEqual({ A1: 'MLB1' });
    expect(res.valor?.precoVivo).toBe(100);
  });
  it('somenteEstoque=true não envia price no PUT plano', async () => {
    let putBody: any = null;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') { putBody = JSON.parse(init.body as string); return Promise.resolve(new Response('{}', { status: 200 })); }
      return Promise.resolve(new Response(JSON.stringify({ id: 'MLB1', variations: [], pictures: [], price: 100, available_quantity: 10 }), { status: 200 }));
    }) as typeof fetch;
    const atualiz: AtualizacaoCanonica = {
      itemExternoId: 'MLB1',
      existentes: [{ sku: 'A1', estoque: 20, cor: 'Prata' }],
      novas: [],
      capaFotoId: null, capa2FotoId: null, capa3FotoId: null, categoriaId: null,
      marca: null, dimensoes: null, desconto: null, precoFamilia: 130,
      somenteEstoque: true,
    };
    await mercadoLivreConnector.atualizarAnuncio(ctxFake, atualiz);
    expect(putBody).toEqual({ available_quantity: 20 });
  });
  it('GET sem variations + >1 existente ou cor nova → falha alto, nunca manda PUT vazio (no-op silencioso)', async () => {
    let putChamado = false;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') putChamado = true;
      return Promise.resolve(new Response(JSON.stringify({ id: 'MLB1', variations: [], pictures: [] }), { status: 200 }));
    }) as typeof fetch;
    const atualiz: AtualizacaoCanonica = {
      itemExternoId: 'MLB1',
      existentes: [{ sku: 'A1', estoque: 10, cor: 'Prata' }],
      novas: [{ sku: 'N1', cor: 'Rosa', estoque: 4, preco: 30, gtin: null, fotoId: 'P' }],
      capaFotoId: null, capa2FotoId: null, capa3FotoId: null, categoriaId: null,
      marca: null, dimensoes: null, desconto: null, precoFamilia: null,
      somenteEstoque: false,
    };
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, atualiz);
    expect(res.ok).toBe(false);
    expect(putChamado).toBe(false);
  });
});
