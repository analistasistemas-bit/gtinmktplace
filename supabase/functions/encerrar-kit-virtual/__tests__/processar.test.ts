// ADR-0154 D-8: encerrar Kit Virtual. Vitest (não Deno test) — runner real do CI.
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { encerrarKitVirtual, type EncerrarKitVirtualDeps } from '../processar.ts';

const ORG = 'org-1';

interface LinhaKit extends Record<string, unknown> {
  id: string; org_id: string; status: string; ml_item_id: string | null; encerrado_em: string | null;
}

function novoEstado(over: Partial<LinhaKit> = {}): { kits: LinhaKit[]; ops: string[] } {
  return {
    kits: [{ id: 'kit-1', org_id: ORG, status: 'publicado', ml_item_id: 'MLB999', encerrado_em: null, ...over }],
    ops: [],
  };
}

function fakeAdmin(st: { kits: LinhaKit[]; ops: string[] }): SupabaseClient {
  const from = (tabela: string) => {
    if (tabela !== 'kits_virtuais') throw new Error(`tabela inesperada no fake: ${tabela}`);
    const q = { op: 'select' as 'select' | 'update', payload: {} as Record<string, unknown>, filtros: [] as { col: string; val: unknown }[] };
    const resolver = () => {
      const alvos = st.kits.filter((k) => q.filtros.every((f) => k[f.col] === f.val));
      if (q.op === 'update') {
        st.ops.push(`update:${q.payload.status ?? Object.keys(q.payload).join('+')}`);
        for (const a of alvos) Object.assign(a, q.payload);
        return Promise.resolve({ data: null, error: null });
      }
      st.ops.push('select');
      return Promise.resolve({ data: alvos[0] ? { ...alvos[0] } : null, error: null });
    };
    const chain: Record<string, unknown> = {
      update: (p: Record<string, unknown>) => { q.op = 'update'; q.payload = p; return chain; },
      select: () => chain,
      eq: (col: string, val: unknown) => { q.filtros.push({ col, val }); return chain; },
      maybeSingle: resolver,
      single: resolver,
      then: (ok: unknown, err: unknown) => resolver().then(ok as never, err as never),
    };
    return chain;
  };
  return { from } as unknown as SupabaseClient;
}

function deps(st: { kits: LinhaKit[]; ops: string[] }, over: Partial<EncerrarKitVirtualDeps> = {}): EncerrarKitVirtualDeps {
  return {
    admin: fakeAdmin(st),
    orgId: ORG,
    buscarItem: async () => ({ status: 'active' }),
    fecharItem: async () => {},
    ...over,
  };
}

describe('encerrarKitVirtual', () => {
  it('GET-primeiro: lê o item antes de escrever e fecha com status closed', async () => {
    const st = novoEstado();
    const ordem: string[] = [];
    const buscarItem = vi.fn(async () => { ordem.push('get'); return { status: 'active' }; });
    const fecharItem = vi.fn(async () => { ordem.push('put'); });

    const r = await encerrarKitVirtual(deps(st, { buscarItem, fecharItem }), { kitId: 'kit-1' });

    expect(r).toEqual({ ok: true, kitId: 'kit-1', jaEncerrado: false });
    expect(ordem).toEqual(['get', 'put']);
    expect(fecharItem).toHaveBeenCalledWith('MLB999');
    expect(st.kits[0].status).toEqual('encerrado');
    expect(st.kits[0].encerrado_em).toBeTruthy();
  });

  it('item JÁ closed no ML é sucesso idempotente: não faz PUT nenhum', async () => {
    const st = novoEstado();
    const fecharItem = vi.fn();
    const r = await encerrarKitVirtual(
      deps(st, { buscarItem: async () => ({ status: 'closed' }), fecharItem }),
      { kitId: 'kit-1' },
    );
    expect(r).toEqual({ ok: true, kitId: 'kit-1', jaEncerrado: true });
    expect(fecharItem).not.toHaveBeenCalled();
    expect(st.kits[0].status).toEqual('encerrado');
  });

  it('kit já encerrado localmente: nem chega a tocar no ML', async () => {
    const st = novoEstado({ status: 'encerrado' });
    const buscarItem = vi.fn();
    const r = await encerrarKitVirtual(deps(st, { buscarItem }), { kitId: 'kit-1' });
    expect(r).toEqual({ ok: true, kitId: 'kit-1', jaEncerrado: true });
    expect(buscarItem).not.toHaveBeenCalled();
    expect(st.ops).toEqual(['select']);
  });

  it('kit que nunca chegou ao ML encerra só localmente', async () => {
    const st = novoEstado({ status: 'erro', ml_item_id: null });
    const buscarItem = vi.fn();
    const fecharItem = vi.fn();
    const r = await encerrarKitVirtual(deps(st, { buscarItem, fecharItem }), { kitId: 'kit-1' });
    expect(r).toEqual({ ok: true, kitId: 'kit-1', jaEncerrado: true });
    expect(buscarItem).not.toHaveBeenCalled();
    expect(fecharItem).not.toHaveBeenCalled();
    expect(st.kits[0].status).toEqual('encerrado');
  });

  it('item sumiu do ML (404 no GET): encerra local, sem PUT', async () => {
    const st = novoEstado();
    const fecharItem = vi.fn();
    const erro404 = Object.assign(new Error('não encontrado'), { status: 404 });
    const r = await encerrarKitVirtual(
      deps(st, { buscarItem: async () => { throw erro404; }, fecharItem }),
      { kitId: 'kit-1' },
    );
    expect(r).toEqual({ ok: true, kitId: 'kit-1', jaEncerrado: true });
    expect(fecharItem).not.toHaveBeenCalled();
    expect(st.kits[0].status).toEqual('encerrado');
  });

  it('GET que falha por outro motivo NÃO marca encerrado (o kit continuaria no ar)', async () => {
    const st = novoEstado();
    const erro403 = Object.assign(new Error('token sem permissão'), { status: 403 });
    const r = await encerrarKitVirtual(
      deps(st, { buscarItem: async () => { throw erro403; } }),
      { kitId: 'kit-1' },
    );
    expect(r).toMatchObject({ ok: false, motivo: 'ml_recusou', mensagem: 'token sem permissão' });
    expect(st.kits[0].status).toEqual('publicado');
  });

  it('PUT recusado pelo ML NÃO marca encerrado', async () => {
    const st = novoEstado();
    const r = await encerrarKitVirtual(
      deps(st, { fecharItem: async () => { throw new Error('O Mercado Livre recusou (erro 400).'); } }),
      { kitId: 'kit-1' },
    );
    expect(r).toMatchObject({ ok: false, motivo: 'ml_recusou' });
    expect(st.kits[0].status).toEqual('publicado');
    expect(st.ops).toEqual(['select']);
  });

  it('kit de outra org / inexistente devolve nao_encontrado', async () => {
    const st = novoEstado();
    const r = await encerrarKitVirtual(deps(st), { kitId: 'kit-outro' });
    expect(r).toEqual({ ok: false, motivo: 'nao_encontrado' });
  });
});
