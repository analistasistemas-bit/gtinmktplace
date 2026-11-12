import { describe, it, expect } from 'vitest';
import { itemIdDaBase, propostaGaleriaBase, MAX_FOTOS_BASE_KIT } from '../galeria-base.ts';

type Item = { id: string; status: string; sub_status?: string[]; pictures: Array<{ id: string; secure_url: string }> };
const item = (fotos: string[], status = 'active', sub: string[] = []): Item => ({
  id: 'MLB-B', status, sub_status: sub, pictures: fotos.map((p) => ({ id: p, secure_url: `https://x/${p}.jpg` })),
});
const fotos = (n: number) => Array.from({ length: n }, (_, i) => `B${i + 1}`);
/** Roteia /categories (limite) e /items/bulk (itens). */
function fakeML(it: Item | null, limite: number | null) {
  return (async (url: string) => {
    const u = String(url);
    if (u.includes('/categories/')) return Response.json(limite === null ? {} : { settings: { max_pictures_per_item: limite } });
    return Response.json(it ? [{ code: 200, body: it }] : [{ code: 404 }]);
  }) as unknown as typeof fetch;
}
const base = { token: 't', itemIdBase: 'MLB-B', categoriaKitId: 'MLB188064' };

describe('itemIdDaBase', () => {
  it('lê familias.ml_item_id; vazio → null', () => {
    expect(itemIdDaBase({ ml_item_id: 'MLB1' })).toBe('MLB1');
    expect(itemIdDaBase({ ml_item_id: null })).toBeNull();
    expect(itemIdDaBase({})).toBeNull();
  });
});

describe('propostaGaleriaBase', () => {
  it('ignora a foto 1 e corta em MAX_FOTOS_BASE_KIT', async () => {
    const r = await propostaGaleriaBase(base, fakeML(item(fotos(12)), 12));
    expect(MAX_FOTOS_BASE_KIT).toBe(6);
    expect(r.fotos.map((x) => x.id)).toEqual(['B2', 'B3', 'B4', 'B5', 'B6', 'B7']);
    expect(r.fotos[0]).toEqual({ id: 'B2', item: 'MLB-B', url: 'https://x/B2.jpg' });
    expect(r.limite).toBe(12);
    expect(r.indisponivel).toBe(false);
  });

  it('respeita limite-1 vagas da categoria do kit', async () => {
    const r = await propostaGaleriaBase(base, fakeML(item(fotos(12)), 4));
    expect(r.fotos.map((x) => x.id)).toEqual(['B2', 'B3', 'B4']);
  });

  it('limite ilegível → vazia, sem presumir', async () => {
    const r = await propostaGaleriaBase(base, fakeML(item(fotos(12)), null));
    expect(r.fotos).toEqual([]);
    expect(r.limite).toBeNull();
  });

  it('item não limpo → vazia com aviso', async () => {
    const r = await propostaGaleriaBase(base, fakeML(item(fotos(5), 'under_review'), 12));
    expect(r.fotos).toEqual([]);
    expect(r.avisos.length).toBeGreaterThan(0);
  });

  it('base não publicada ou sem categoria → vazia, sem aviso nem chamada', async () => {
    const f = (async () => { throw new Error('não deveria chamar'); }) as unknown as typeof fetch;
    expect(await propostaGaleriaBase({ ...base, itemIdBase: null }, f)).toEqual({ fotos: [], avisos: [], indisponivel: false, limite: null });
    expect((await propostaGaleriaBase({ ...base, categoriaKitId: null }, f)).fotos).toEqual([]);
  });

  it('falha do ML → indisponivel', async () => {
    const f = (async (url: string) => String(url).includes('/categories/')
      ? Response.json({ settings: { max_pictures_per_item: 12 } }) : new Response('x', { status: 500 })) as unknown as typeof fetch;
    const r = await propostaGaleriaBase(base, f);
    expect(r.indisponivel).toBe(true);
    expect(r.fotos).toEqual([]);
  });
});
