import { describe, it, expect, afterEach, vi } from 'vitest';
import { buscarItemML, excluirItemML } from '../atualizar-item';

const globalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = globalFetch; });

describe('buscarItemML', () => {
  it('extrai price por variacao', async () => {
    const fakeFetch = () => Promise.resolve(new Response(JSON.stringify({
      id: 'MLB1',
      variations: [{ id: 9, seller_custom_field: 'A1', available_quantity: 3, price: 42.5, picture_ids: [] }],
      pictures: [],
    }), { status: 200 }));
    globalThis.fetch = fakeFetch as typeof fetch;
    const item = await buscarItemML('tok', 'MLB1');
    expect(item.variations[0].price).toBe(42.5);
  });

  it('extrai sold_quantity', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({
      id: 'MLB1', sold_quantity: 5, variations: [], pictures: [],
    }), { status: 200 }))) as typeof fetch;
    const item = await buscarItemML('tok', 'MLB1');
    expect(item.soldQuantity).toBe(5);
  });
});

describe('excluirItemML', () => {
  afterEach(() => { globalThis.fetch = globalFetch; vi.restoreAllMocks(); });

  it('closed + deleted + confirma 404', async () => {
    let gets = 0;
    globalThis.fetch = vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT') return new Response('{}', { status: 200 });
      gets++;
      if (gets <= 1) {
        return new Response(JSON.stringify({
          id: 'MLB1', status: 'active', sub_status: [], sold_quantity: 0, variations: [], pictures: [],
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    await excluirItemML('tok', 'MLB1');
    expect(gets).toBeGreaterThan(1);
  });
});
