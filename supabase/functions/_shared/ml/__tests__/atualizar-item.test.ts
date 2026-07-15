import { describe, it, expect, afterEach } from 'vitest';
import { buscarItemML } from '../atualizar-item';

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
});
