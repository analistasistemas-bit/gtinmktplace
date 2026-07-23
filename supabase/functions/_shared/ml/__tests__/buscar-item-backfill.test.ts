import { describe, it, expect } from 'vitest';
import { buscarItemBackfill, type FetchLike } from '../buscar-item';

// ADR-0088 — Reconciliador de backfill: GET completo do item pra decidir se é candidato a
// importar pro modelo UP (item plano com family_name, ainda sem filho técnico local).

function resp(json: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(json) });
}

describe('buscarItemBackfill (GET completo pro reconciliador de backfill)', () => {
  it('pede os atributos necessários pra decisão de import, incluindo seller_id (revisão Codex: verificar posse)', async () => {
    let urlVista = '';
    const f: FetchLike = (url) => {
      urlVista = url;
      return resp({
        id: 'MLB1', status: 'active', family_id: 'FAM1', family_name: 'Cor', user_product_id: 'UP1',
        permalink: 'https://ml/MLB1', seller_custom_field: '00123', variations: [], seller_id: 999,
      });
    };
    const r = await buscarItemBackfill(f, { accessToken: 'tok' }, 'MLB1');
    expect(urlVista).toContain('/items/MLB1');
    expect(urlVista).toContain('family_name');
    expect(urlVista).toContain('seller_custom_field');
    expect(urlVista).toContain('variations');
    expect(urlVista).toContain('seller_id');
    expect(r).toEqual({
      status: 'active', familyId: 'FAM1', familyName: 'Cor', userProductId: 'UP1',
      permalink: 'https://ml/MLB1', sku: '00123', temVariacoes: false, sellerId: '999',
    });
  });

  it('seller_id normalizado com String() (o ML pode devolver número)', async () => {
    const f: FetchLike = () => resp({ id: 'MLB1', variations: [], seller_id: 12345 });
    const r = await buscarItemBackfill(f, { accessToken: 'tok' }, 'MLB1');
    expect(r?.sellerId).toBe('12345');
  });

  it('sem seller_id no corpo → sellerId null', async () => {
    const f: FetchLike = () => resp({ id: 'MLB1', variations: [] });
    const r = await buscarItemBackfill(f, { accessToken: 'tok' }, 'MLB1');
    expect(r?.sellerId).toBeNull();
  });

  it('item Legacy (variations não vazio) → temVariacoes=true', async () => {
    const f: FetchLike = () => resp({ id: 'MLB1', variations: [{ id: 1 }, { id: 2 }] });
    const r = await buscarItemBackfill(f, { accessToken: 'tok' }, 'MLB1');
    expect(r?.temVariacoes).toBe(true);
  });

  it('sem family_name → familyName null', async () => {
    const f: FetchLike = () => resp({ id: 'MLB1', variations: [] });
    const r = await buscarItemBackfill(f, { accessToken: 'tok' }, 'MLB1');
    expect(r?.familyName).toBeNull();
  });

  it('sem seller_custom_field → sku null', async () => {
    const f: FetchLike = () => resp({ id: 'MLB1', variations: [] });
    const r = await buscarItemBackfill(f, { accessToken: 'tok' }, 'MLB1');
    expect(r?.sku).toBeNull();
  });

  it('GET falha (404) → null', async () => {
    const f: FetchLike = () => resp({}, false, 404);
    expect(await buscarItemBackfill(f, { accessToken: 'tok' }, 'MLB1')).toBeNull();
  });
});
