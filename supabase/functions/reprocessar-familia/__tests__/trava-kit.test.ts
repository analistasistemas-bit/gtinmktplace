import { beforeAll, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ serve: vi.fn(), is: [] as string[] }));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({ requireUserOrg: vi.fn(async () => ({ userId: 'u', orgId: 'org-1' })) }));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: vi.fn(async () => {}) }));
vi.mock('../../_shared/queue.ts', () => ({ enfileirarFamilias: vi.fn(async () => []) }));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q,
        is: (col: string) => { f.is.push(col); return q; },
        then: (res: (v: unknown) => void) => res({ data: [], error: null }),
      };
      return q;
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

describe('reprocessar-familia — trava de kit', () => {
  it('filtra fora kit vinculado e kit com variação', async () => {
    await handler(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ familia_id: 'x' }) }));
    expect(f.is).toContain('kit_multiplicador');
    expect(f.is).toContain('kit_variacao_pedido');
  });
});
