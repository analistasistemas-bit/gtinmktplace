// ADR-0187 — fail-closed na leitura do módulo fiscal: erro de leitura NÃO vira "sem módulo" (403).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  modulo: 'ligado' as 'ligado' | 'desligado' | 'erro',
  iaChamada: 0,
}));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn().mockResolvedValue({ userId: 'user-1', orgId: 'org-1' }),
}));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q,
        maybeSingle: async () => f.modulo === 'erro'
          ? { data: null, error: { message: 'fora do ar' } }
          : { data: { modulos_habilitados: f.modulo === 'ligado' ? ['fiscal'] : [] }, error: null },
      };
      return q;
    },
    rpc: async (_n: string, a: { p_codigos: string[] }) => ({ data: a.p_codigos.map((codigo) => ({ codigo, vigente: true })), error: null }),
  }),
}));
vi.mock('../../_shared/ai/modelos.ts', () => ({ resolverModeloTexto: vi.fn(async () => 'm') }));
vi.mock('../../_shared/ai/client.ts', () => ({
  openrouterClient: () => ({
    chat: { completions: { create: async () => {
      f.iaChamada++;
      return { choices: [{ message: { content: '{"ncm":"62034900","justificativa":"calça"}' } }] };
    } } },
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});
beforeEach(() => { f.modulo = 'ligado'; f.iaChamada = 0; });
const post = () => handler(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ nome: 'Calça' }) }));

describe('sugerir-ncm — leitura do módulo fiscal', () => {
  it('erro de leitura → 500 (não 403 "sem módulo"), IA não é chamada', async () => {
    f.modulo = 'erro';
    const r = await post();
    expect(r.status).toBe(500);
    expect(f.iaChamada).toBe(0);
  });
  it('módulo desligado de verdade → 403', async () => {
    f.modulo = 'desligado';
    expect((await post()).status).toBe(403);
  });
  it('módulo ligado → sugestão filtrada pela tabela oficial', async () => {
    const r = await post();
    expect(r.status).toBe(200);
    expect((await r.json()).ncm).toBe('62034900');
  });
});
