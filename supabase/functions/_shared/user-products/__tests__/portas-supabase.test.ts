import { describe, it, expect, vi, afterEach } from 'vitest';
import { criarPortasSupabase } from '../portas-supabase';
import type { FetchLike } from '../../ml/buscar-item';
import type { PayloadItem } from '../../ml/publicar';

// Fake mínimo do SupabaseClient: grava as chamadas (tabela/op/payload/opções/filtros) para
// asserção. Cobre só os padrões que as portas usam: select/upsert/update + eq encadeado.
function fakeAdmin(seedItens: Record<string, unknown>[] = []) {
  const calls: Array<{ table: string; op: string; payload?: unknown; options?: unknown; filters: Record<string, unknown> }> = [];
  function chain(table: string) {
    const rec = { table, op: '', payload: undefined as unknown, options: undefined as unknown, filters: {} as Record<string, unknown> };
    const resolver = () => {
      if (rec.op === 'select') return { data: seedItens, error: null };
      return { data: null, error: null };
    };
    const api: Record<string, unknown> = {
      select: () => { rec.op = 'select'; return api; },
      upsert: (payload: unknown, options: unknown) => { rec.op = 'upsert'; rec.payload = payload; rec.options = options; calls.push(rec); return Promise.resolve({ error: null }); },
      update: (payload: unknown) => { rec.op = 'update'; rec.payload = payload; return api; },
      eq: (col: string, val: unknown) => { rec.filters[col] = val; return api; },
      then: (resolve: (v: unknown) => unknown) => { if (rec.op) calls.push(rec); return Promise.resolve(resolver()).then(resolve); },
    };
    return api;
  }
  return { admin: { from: chain } as never, calls };
}

const BASE = {
  sellerId: 'seller-1', orgId: 'org-1', categoriaId: 'MLB419782',
  familyName: 'AGULHA [p0]', desdeMs: Date.parse('2026-07-01'),
  getToken: () => Promise.resolve('tok'),
  montarPayloadPlano: (sku: string) => ({ seller_custom_field: sku, category_id: 'MLB419782', family_name: 'AGULHA [p0]' } as unknown as PayloadItem),
};

afterEach(() => vi.restoreAllMocks());

describe('criarPortasSupabase — adapter real das portas da saga', () => {
  it('listar: select em anuncios_externos_itens por anuncio_externo_id → FilhoRow[]', async () => {
    const { admin, calls } = fakeAdmin([
      { sku: 's1', status: 'ativo', retirado: false, item_externo_id: 'MLB1' },
      { sku: 's2', status: 'pendente', retirado: false, item_externo_id: null },
    ]);
    const p = criarPortasSupabase({ admin, ...BASE });
    const rows = await p.listar('root-1');
    expect(rows).toEqual([
      { sku: 's1', status: 'ativo', retirado: false, itemExternoId: 'MLB1' },
      { sku: 's2', status: 'pendente', retirado: false, itemExternoId: null },
    ]);
    const c = calls.find((x) => x.table === 'anuncios_externos_itens' && x.op === 'select')!;
    expect(c.filters.anuncio_externo_id).toBe('root-1');
  });

  it('reservar: upsert insert-if-absent com org_id e onConflict (anuncio_externo_id,sku)', async () => {
    const { admin, calls } = fakeAdmin();
    const p = criarPortasSupabase({ admin, ...BASE });
    await p.reservar('root-1', ['s1', 's2']);
    const c = calls.find((x) => x.op === 'upsert')!;
    expect(c.table).toBe('anuncios_externos_itens');
    expect(c.payload).toEqual([
      { anuncio_externo_id: 'root-1', org_id: 'org-1', sku: 's1', status: 'pendente' },
      { anuncio_externo_id: 'root-1', org_id: 'org-1', sku: 's2', status: 'pendente' },
    ]);
    expect(c.options).toEqual({ onConflict: 'anuncio_externo_id,sku', ignoreDuplicates: true });
  });

  it('salvarStatus: update do status por (anuncio_externo_id, sku)', async () => {
    const { admin, calls } = fakeAdmin();
    const p = criarPortasSupabase({ admin, ...BASE });
    await p.salvarStatus('root-1', 's1', 'criacao_incerta');
    const c = calls.find((x) => x.op === 'update')!;
    expect(c.table).toBe('anuncios_externos_itens');
    expect(c.payload).toEqual({ status: 'criacao_incerta' });
    expect(c.filters).toEqual({ anuncio_externo_id: 'root-1', sku: 's1' });
  });

  it('salvarCriado: grava item_externo_id + status=criado por (anuncio_externo_id, sku)', async () => {
    const { admin, calls } = fakeAdmin();
    const p = criarPortasSupabase({ admin, ...BASE });
    await p.salvarCriado('root-1', 's1', 'MLB9');
    const c = calls.find((x) => x.op === 'update')!;
    expect(c.payload).toEqual({ item_externo_id: 'MLB9', status: 'criado' });
    expect(c.filters).toEqual({ anuncio_externo_id: 'root-1', sku: 's1' });
  });

  it('salvarConfirmacao: grava family_id/user_product_id/permalink por (anuncio_externo_id, sku)', async () => {
    const { admin, calls } = fakeAdmin();
    const p = criarPortasSupabase({ admin, ...BASE });
    await p.salvarConfirmacao('root-1', 's1', { familyId: 'FAM1', userProductId: 'UP1', permalink: 'https://ml/x' });
    const c = calls.find((x) => x.op === 'update')!;
    expect(c.payload).toEqual({ family_id: 'FAM1', user_product_id: 'UP1', permalink: 'https://ml/x' });
    expect(c.filters).toEqual({ anuncio_externo_id: 'root-1', sku: 's1' });
  });

  it('salvarEstadoDesejado: update na RAIZ (anuncios_externos por id)', async () => {
    const { admin, calls } = fakeAdmin();
    const p = criarPortasSupabase({ admin, ...BASE });
    await p.salvarEstadoDesejado('root-1', 'ativando');
    const c = calls.find((x) => x.op === 'update')!;
    expect(c.table).toBe('anuncios_externos');
    expect(c.payload).toEqual({ estado_desejado: 'ativando' });
    expect(c.filters).toEqual({ id: 'root-1' });
  });

  it('confirmar: GET ok com family_id e seller esperado → ConfirmacaoRemota ok', async () => {
    const { admin } = fakeAdmin();
    const fetchLike: FetchLike = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'MLB1', family_id: 'FAM1', user_product_id: 'UP1', seller_id: 'seller-1', permalink: 'https://ml/MLB1', status: 'active' }) });
    const p = criarPortasSupabase({ admin, ...BASE, fetchLike });
    expect(await p.confirmar('MLB1')).toEqual({ ok: true, familyId: 'FAM1', userProductId: 'UP1', permalink: 'https://ml/MLB1' });
  });

  it('confirmar: seller divergente → ok=false (nunca confirma item de outro vendedor)', async () => {
    const { admin } = fakeAdmin();
    const fetchLike: FetchLike = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'MLB1', family_id: 'FAM1', seller_id: 'OUTRO' }) });
    const p = criarPortasSupabase({ admin, ...BASE, fetchLike });
    expect((await p.confirmar('MLB1')).ok).toBe(false);
  });

  it('confirmar: family_id ausente → ok=false', async () => {
    const { admin } = fakeAdmin();
    const fetchLike: FetchLike = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'MLB1', seller_id: 'seller-1' }) });
    const p = criarPortasSupabase({ admin, ...BASE, fetchLike });
    expect((await p.confirmar('MLB1')).ok).toBe(false);
  });

  it('confirmar: GET 404 → ok=false', async () => {
    const { admin } = fakeAdmin();
    const fetchLike: FetchLike = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    const p = criarPortasSupabase({ admin, ...BASE, fetchLike });
    expect((await p.confirmar('MLB1')).ok).toBe(false);
  });

  it('buscarPorSku: delega a buscarItemPorSku com os critérios da partição', async () => {
    const { admin } = fakeAdmin();
    let urlBusca = '';
    const fetchLike: FetchLike = (url) => {
      if (url.includes('/items/search')) { urlBusca = url; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [], paging: { total: 0 } }) }); }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    };
    const p = criarPortasSupabase({ admin, ...BASE, fetchLike });
    const r = await p.buscarPorSku('s1');
    expect(r).toEqual({ tipo: 'nenhum' });
    expect(urlBusca).toContain('/users/seller-1/items/search');
    expect(urlBusca).toContain('sku=s1');
  });

  it('criarPlano: monta payload plano do SKU e cria via POST /items', async () => {
    const { admin } = fakeAdmin();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'MLB55', permalink: 'https://ml/MLB55', variations: [] }), { status: 201 }),
    );
    const montado: string[] = [];
    const p = criarPortasSupabase({ admin, ...BASE, montarPayloadPlano: (sku) => { montado.push(sku); return { seller_custom_field: sku } as unknown as PayloadItem; } });
    const r = await p.criarPlano('s1');
    expect(r).toEqual({ itemExternoId: 'MLB55', permalink: 'https://ml/MLB55' });
    expect(montado).toEqual(['s1']);
    expect(fetchSpy).toHaveBeenCalledWith('https://api.mercadolibre.com/items', expect.objectContaining({ method: 'POST' }));
  });

  it('mudarStatus: PUT de status (ativo→active, pausado→paused)', async () => {
    const { admin } = fakeAdmin();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const p = criarPortasSupabase({ admin, ...BASE });
    await p.mudarStatus('MLB1', 'pausado');
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ status: 'paused' });
  });
});
