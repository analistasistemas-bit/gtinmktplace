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
