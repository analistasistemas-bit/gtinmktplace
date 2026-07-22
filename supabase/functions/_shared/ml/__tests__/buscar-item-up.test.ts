import { describe, it, expect } from 'vitest';
import { buscarItemUP, type FetchLike } from '../buscar-item';

// GET /items/{id} de confirmação da saga UP: precisa de family_id/user_product_id/seller_id
// (buscarItemML NÃO traz esses campos). Devolve os campos crus; a porta decide ok/seller-match.

function resp(json: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(json) });
}

describe('buscarItemUP (GET de confirmação da saga)', () => {
  it('pede os atributos family_id/user_product_id/seller_id/permalink/status', async () => {
    let urlVista = '';
    const f: FetchLike = (url) => { urlVista = url; return resp({ id: 'MLB1', family_id: 'FAM1', user_product_id: 'UP1', seller_id: 99, permalink: 'https://ml/MLB1', status: 'active' }); };
    const r = await buscarItemUP(f, { accessToken: 'tok' }, 'MLB1');
    expect(urlVista).toContain('/items/MLB1');
    expect(urlVista).toContain('family_id');
    expect(urlVista).toContain('user_product_id');
    expect(urlVista).toContain('seller_id');
    expect(r).toEqual({ status: 'active', familyId: 'FAM1', userProductId: 'UP1', permalink: 'https://ml/MLB1', sellerId: '99' });
  });

  it('seller_id vem normalizado com String() (o ML pode devolver número)', async () => {
    const f: FetchLike = () => resp({ id: 'MLB1', family_id: 'FAM1', seller_id: 12345 });
    const r = await buscarItemUP(f, { accessToken: 'tok' }, 'MLB1');
    expect(r?.sellerId).toBe('12345');
  });

  it('GET falha (404) → null', async () => {
    const f: FetchLike = () => resp({}, false, 404);
    expect(await buscarItemUP(f, { accessToken: 'tok' }, 'MLB1')).toBeNull();
  });

  it('family_id ausente → devolve familyId undefined (a porta trata como ok=false)', async () => {
    const f: FetchLike = () => resp({ id: 'MLB1', seller_id: 1 });
    const r = await buscarItemUP(f, { accessToken: 'tok' }, 'MLB1');
    expect(r?.familyId).toBeUndefined();
  });
});
