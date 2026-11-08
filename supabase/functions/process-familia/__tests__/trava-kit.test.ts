import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  claimed: null as Record<string, unknown> | null,
  updates: [] as unknown[],
  conexoes: 0,
}));

vi.mock('../../_shared/queue.ts', () => ({ verificarAssinatura: vi.fn(async () => true) }));
vi.mock('../../_shared/canais/conexao.ts', () => ({
  resolverConexao: vi.fn(async () => { f.conexoes++; return null; }),
}));
vi.mock('../../_shared/ai/client.ts', () => ({ openrouterClient: () => ({}) }));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        update: (v: unknown) => { f.updates.push(v); return q; },
        eq: () => q, select: () => q,
        maybeSingle: async () => ({ data: f.claimed, error: null }),
        then: (res: (v: unknown) => void) => res({ data: null, error: null }),
      };
      return q;
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => undefined } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});
beforeEach(() => { f.updates = []; f.conexoes = 0; });
const post = () => handler(new Request('http://localhost', {
  method: 'POST', body: JSON.stringify({ familia_id: 'fam-1', lote_id: 'lote-1' }),
}));

describe('process-familia — trava de kit', () => {
  it('família de kit com variação volta a pronto e não segue para a IA', async () => {
    f.claimed = { id: 'fam-1', org_id: 'org-1', kit_multiplicador: null, kit_variacao_pedido: 'hash' };
    const r = await post();
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('Kit vinculado não passa por process-familia');
    expect(f.updates).toContainEqual({ status: 'pronto' });
    expect(f.conexoes).toBe(0);
  });
  it('kit vinculado continua recusado', async () => {
    f.claimed = { id: 'fam-1', org_id: 'org-1', kit_multiplicador: 3, kit_variacao_pedido: null };
    await post();
    expect(f.updates).toContainEqual({ status: 'pronto' });
    expect(f.conexoes).toBe(0);
  });
  it('família comum segue o fluxo (chega a resolver a conexão)', async () => {
    f.claimed = { id: 'fam-1', org_id: 'org-1', kit_multiplicador: null, kit_variacao_pedido: null };
    await post().catch(() => {});
    expect(f.conexoes).toBe(1);
  });
});
