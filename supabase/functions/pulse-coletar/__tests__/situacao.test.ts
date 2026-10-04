import { afterEach, describe, expect, it, vi } from 'vitest';
// processar.ts → token.ts → supabase.ts alcança import `jsr:`; mesmo mock dos testes existentes do Pulse.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));
import { lerSituacaoAnuncios } from '../processar.ts';
afterEach(() => vi.unstubAllGlobals());

describe('lerSituacaoAnuncios', () => {
  it('blocos de 20; 404 individual fora; bloco com HTTP 500 não derruba os outros', async () => {
    const ids = Array.from({ length: 41 }, (_, i) => `MLB${i}`);
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      n++;
      if (n === 2) return new Response('x', { status: 500 });
      const q = (new URL(u).searchParams.get('ids') ?? '').split(',');
      return new Response(JSON.stringify(q.map((id) => (id === 'MLB5'
        ? { status_code: 404 }
        : { status_code: 200, body: { id, status: 'active', sub_status: [], category_id: 'C', listing_type_id: 'gold_pro', price: 9 } }))));
    }));
    const m = await lerSituacaoAnuncios(ids, 't');
    expect(n).toBe(3);
    expect(String((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toContain('/items/bulk?ids=');
    expect(String((fetch as unknown as { mock: { calls: string[][] } }).mock.calls[0][0])).toContain('&attributes=status_code,body.id,body.status,body.sub_status,body.category_id,body.listing_type_id,body.price');
    expect([...m.keys()].sort()).toEqual([...ids.slice(0, 20).filter((i) => i !== 'MLB5'), ids[40]].sort());
    expect(m.get('MLB0')).toEqual({ item_id: 'MLB0', status: 'active', sub_status: [], category_id: 'C', listing_type_id: 'gold_pro', price: 9 });
  });
});
