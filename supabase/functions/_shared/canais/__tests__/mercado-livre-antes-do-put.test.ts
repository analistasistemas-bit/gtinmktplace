// ADR-0201 Task 14 — gancho opcional `antesDoPut` do conector: ordem adquirir → GET → antesDoPut (estende) → PUT,
// nos dois PUTs do método (item plano e item com variações). Sem rede.
import { afterEach, describe, expect, it } from 'vitest';
import { mercadoLivreConnector } from '../mercado-livre';
import type { AtualizacaoCanonica } from '../contrato';

const globalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = globalFetch; });
const ctx = { getToken: () => Promise.resolve('tok') };

function stub(getBody: unknown, eventos: string[]) {
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    eventos.push(init?.method === 'PUT' ? 'PUT' : 'GET');
    return Promise.resolve(new Response(JSON.stringify(init?.method === 'PUT' ? { variations: [] } : getBody), { status: 200 }));
  }) as typeof fetch;
}

const comVariacoes = {
  id: 'MLB1', status: 'active', sub_status: [], tags: [], pictures: [],
  variations: [{ id: 1, seller_custom_field: 'A1', available_quantity: 9, price: 25, picture_ids: [], attribute_combinations: [{ id: 'COLOR', value_name: 'Azul' }] }],
};
const plano = { id: 'MLB2', status: 'active', sub_status: [], tags: [], pictures: [{ id: 'F1' }], variations: [], available_quantity: 3, price: 10 };
const base = (extra: Partial<AtualizacaoCanonica> = {}): AtualizacaoCanonica => ({
  itemExternoId: 'MLB1', existentes: [{ sku: 'A1', estoque: 9, cor: 'Azul' }], novas: [],
  capaFotoId: null, capa2FotoId: null, capa3FotoId: null, categoriaId: null, marca: null, dimensoes: null,
  precoFamilia: 30, ...extra,
});

describe('atualizarAnuncio — antesDoPut', () => {
  it.each([['com variações (atualizarItemML)', comVariacoes], ['plano (atualizarItemPlanoML)', plano]])(
    'item %s: GET → antesDoPut → PUT', async (_n, get) => {
      const eventos: string[] = [];
      stub(get, eventos);
      const res = await mercadoLivreConnector.atualizarAnuncio(ctx, base({
        antesDoPut: async () => { eventos.push('antesDoPut'); return true; },
      }));
      expect(res.ok).toBe(true);
      expect(eventos.slice(0, 3)).toEqual(['GET', 'antesDoPut', 'PUT']);
    });

  it.each([['com variações', comVariacoes], ['plano', plano]])('item %s: antesDoPut recusado → nenhum PUT, erro 4xx definitivo', async (_n, get) => {
    const eventos: string[] = [];
    stub(get, eventos);
    const res = await mercadoLivreConnector.atualizarAnuncio(ctx, base({ antesDoPut: async () => false }));
    expect(eventos).not.toContain('PUT');
    expect(res.ok).toBe(false);
    expect(res.erro).toMatchObject({ retentavel: false, status: 409 });
  });

  it('somenteEstoque sem gancho → PUT sai normalmente (dispensado da trava)', async () => {
    const eventos: string[] = [];
    stub(comVariacoes, eventos);
    const res = await mercadoLivreConnector.atualizarAnuncio(ctx, base({ somenteEstoque: true }));
    expect(res.ok).toBe(true);
    expect(eventos).toContain('PUT');
  });
});
