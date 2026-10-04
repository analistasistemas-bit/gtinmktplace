import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarUserProductIdsML } from '../leitura-ml.ts';
afterEach(() => vi.unstubAllGlobals());
const resp = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe('buscarUserProductIdsML', () => {
  it('blocos de 20 via /items/bulk, mapeia user_product_id/price/category_id e ignora o 404 sem body', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `MLB${i}`);
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      urls.push(u);
      const q = (new URL(u).searchParams.get('ids') ?? '').split(',');
      return resp(q.map((id) => (id === 'MLB3' ? { status_code: 404 } : { status_code: 200, body: { id, user_product_id: `UP${id}`, price: 10, category_id: 'MLB1' } })));
    }));
    const r = await buscarUserProductIdsML('t', ids);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('/items/bulk?ids=');
    expect(urls[0]).toContain('&attributes=status_code,body.id,body.user_product_id,body.price,body.category_id');
    expect(r).toHaveLength(20);
    expect(r.find((x) => x.itemId === 'MLB3')).toBeUndefined();
    expect(r[0]).toEqual({ itemId: 'MLB0', userProductId: 'UPMLB0', precoAtualML: 10, categoriaMlId: 'MLB1' });
  });
  it('bloco com HTTP de erro (mlGet devolve null) é pulado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 500)));
    expect(await buscarUserProductIdsML('t', ['MLB1'])).toEqual([]);
  });
});
