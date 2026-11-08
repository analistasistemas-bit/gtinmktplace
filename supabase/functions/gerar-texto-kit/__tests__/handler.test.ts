import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  admin: true,
  modulo: true,
  base: { nome_pai: 'Blusa', titulo_ml: 'Blusa Feminina Algodão', descricao_pai: 'Macia', descricao_ml: 'Blusa macia.' } as unknown,
  resposta: '{"titulo":"Blusa Feminina Algodão","descricao":"Blusa macia."}',
  iaChamada: 0,
}));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u', orgId: 'org-1', isAdmin: f.admin })),
}));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: vi.fn(async () => {}) }));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: (t: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q,
        maybeSingle: async () => t === 'organizations'
          ? { data: { modulos_habilitados: f.modulo ? ['kit_variacao'] : [] }, error: null }
          : { data: f.base, error: null },
      };
      return q;
    },
  }),
}));
vi.mock('../../_shared/ai/modelos.ts', () => ({ resolverModeloTexto: vi.fn(async () => 'openai/gpt-4.1-mini') }));
vi.mock('../../_shared/ai/client.ts', () => ({
  openrouterClient: () => ({
    chat: { completions: { create: async () => {
      f.iaChamada++;
      return { choices: [{ message: { content: f.resposta } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } };
    } } },
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});
beforeEach(() => {
  f.admin = true; f.modulo = true; f.iaChamada = 0;
  f.resposta = '{"titulo":"Blusa Feminina Algodão","descricao":"Blusa macia."}';
  f.base = { nome_pai: 'Blusa', titulo_ml: 'Blusa Feminina Algodão', descricao_pai: 'Macia', descricao_ml: 'Blusa macia.' };
});
const post = (b: unknown) => handler(new Request('http://localhost', { method: 'POST', body: JSON.stringify(b) }));
const ok = { familia_base_id: 'fam-1', pecas_por_kit: 4, cores: ['Azul', 'Rosa'] };

describe('gerar-texto-kit', () => {
  it('título com "Kit N" e até 60, descrição com as peças, custo de tokens', async () => {
    const r = await post(ok);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.titulo).toBe('Kit 4 Blusa Feminina Algodão');
    expect(j.titulo.length).toBeLessThanOrEqual(60);
    expect(j.descricao).toContain('4 peças');
    expect(j.tokens_input).toBe(1000);
    expect(j.custo_centavos).toBeGreaterThan(0);
  });
  it('título longo do modelo é cortado em 60 e mantém "Kit N"', async () => {
    f.resposta = JSON.stringify({ titulo: 'Blusa Feminina Manga Curta Algodão Premium Confortável Básica Casual Verão Moda', descricao: 'x' });
    const j = await (await post(ok)).json();
    expect(j.titulo.length).toBeLessThanOrEqual(60);
    expect(j.titulo.startsWith('Kit 4 ')).toBe(true);
  });
  it('não admin → 403, sem IA', async () => {
    f.admin = false;
    expect((await post(ok)).status).toBe(403);
    expect(f.iaChamada).toBe(0);
  });
  it('módulo desligado → 403, sem IA', async () => {
    f.modulo = false;
    expect((await post(ok)).status).toBe(403);
    expect(f.iaChamada).toBe(0);
  });
  it('peças fora de 2..6 → 400', async () => {
    expect((await post({ ...ok, pecas_por_kit: 7 })).status).toBe(400);
    expect((await post({ ...ok, pecas_por_kit: 1 })).status).toBe(400);
  });
  it('base de outra org (não achada) → 404', async () => {
    f.base = null;
    expect((await post(ok)).status).toBe(404);
    expect(f.iaChamada).toBe(0);
  });
  it('resposta da IA inválida → 502, sem texto', async () => {
    f.resposta = 'não é json';
    expect((await post(ok)).status).toBe(502);
  });
});
