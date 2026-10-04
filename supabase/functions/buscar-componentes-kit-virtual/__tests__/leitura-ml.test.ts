import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarUserProductIdsML } from '../leitura-ml.ts';
afterEach(() => vi.unstubAllGlobals());
const resp = (b: unknown, status = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status });
const CAMPOS = '&attributes=status_code,body.id,body.user_product_id,body.price,body.category_id';
const ids21 = Array.from({ length: 21 }, (_, i) => `MLB${i}`);

/** fetch que responde por bloco (lista de ids da URL) e registra URL + Bearer. */
function porBloco(responder: (ids: string[], n: number) => Response) {
  const chamadas: Array<{ url: string; auth: string | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    chamadas.push({ url: u, auth: new Headers(init?.headers).get('Authorization') });
    return responder((new URL(u).searchParams.get('ids') ?? '').split(','), chamadas.length);
  }));
  return chamadas;
}
const ok = (id: string) => ({ status_code: 200, body: { id, user_product_id: `UP${id}`, price: 10, category_id: 'MLB1' } });

describe('buscarUserProductIdsML', () => {
  it('blocos de 20 + 1: URL completa do bulk com os ids exatos de cada bloco e Bearer; 404 sem body fora', async () => {
    const chamadas = porBloco((ids) => resp(ids.map((id) => (id === 'MLB3' ? { status_code: 404 } : ok(id)))));
    const r = await buscarUserProductIdsML('tok', ids21);
    expect(chamadas).toEqual([
      { url: `https://api.mercadolibre.com/items/bulk?ids=${ids21.slice(0, 20).join(',')}${CAMPOS}`, auth: 'Bearer tok' },
      { url: `https://api.mercadolibre.com/items/bulk?ids=MLB20${CAMPOS}`, auth: 'Bearer tok' },
    ]);
    expect(r.map((x) => x.itemId)).toEqual(ids21.filter((i) => i !== 'MLB3'));
    expect(r[0]).toEqual({ itemId: 'MLB0', userProductId: 'UPMLB0', precoAtualML: 10, categoriaMlId: 'MLB1' });
  });
  it('bloco do meio com HTTP 500 (mlGet → null) é pulado e os outros seguem', async () => {
    const ids41 = Array.from({ length: 41 }, (_, i) => `MLB${i}`);
    porBloco((ids, n) => (n === 2 ? resp({}, 500) : resp(ids.map(ok))));
    const r = await buscarUserProductIdsML('tok', ids41);
    expect(r.map((x) => x.itemId)).toEqual([...ids41.slice(0, 20), 'MLB40']);
  });
  it('HTTP 200 com objeto ou null (não-array) → bloco ignorado, sem lançar, próximo bloco segue', async () => {
    porBloco((ids, n) => (n === 1 ? resp({ message: 'x' }) : resp(ids.map(ok))));
    expect((await buscarUserProductIdsML('tok', ids21)).map((x) => x.itemId)).toEqual(['MLB20']);
    porBloco((ids, n) => (n === 1 ? resp('null') : resp(ids.map(ok))));
    expect((await buscarUserProductIdsML('tok', ids21)).map((x) => x.itemId)).toEqual(['MLB20']);
  });
  it('entrada sem body ou sem id fica fora; campos ausentes viram null; preço não numérico vira null', async () => {
    porBloco(() => resp([
      { status_code: 200 },
      { status_code: 200, body: { user_product_id: 'UPX' } },
      { status_code: 200, body: { id: 'MLB3' } },
      { status_code: 200, body: { id: 'MLB4', user_product_id: 'UP4', price: '10', category_id: 'C' } },
    ]));
    expect(await buscarUserProductIdsML('tok', ['MLB1', 'MLB2', 'MLB3', 'MLB4'])).toEqual([
      { itemId: 'MLB3', userProductId: null, precoAtualML: null, categoriaMlId: null },
      { itemId: 'MLB4', userProductId: 'UP4', precoAtualML: null, categoriaMlId: 'C' },
    ]);
  });
  it('lista vazia → nenhuma chamada', async () => {
    const chamadas = porBloco(() => resp([]));
    expect(await buscarUserProductIdsML('tok', [])).toEqual([]);
    expect(chamadas).toEqual([]);
  });
});
