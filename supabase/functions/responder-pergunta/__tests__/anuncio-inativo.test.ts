import { beforeAll, describe, expect, it, vi } from 'vitest';

const fronteiras = vi.hoisted(() => ({ serve: vi.fn(), responder: vi.fn() }));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn().mockResolvedValue({ userId: 'user-1', orgId: 'org-1', isAdmin: false, support: null }),
}));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { criado_por: 'owner-1' }, error: null }) };
      return query;
    },
  }),
}));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: vi.fn() }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn().mockResolvedValue('token-ml') }));
vi.mock('../../_shared/canais/conexao.ts', () => ({ mapearConexao: () => ({ contaExternaId: 'seller-1' }) }));
vi.mock('../../_shared/faturamento/perguntas-io.ts', () => ({
  responderAnswer: fronteiras.responder,
  buscarPergunta: vi.fn(),
  upsertPergunta: vi.fn(),
  buscarTituloItem: vi.fn(),
}));

let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: fronteiras.serve });
  await import('../index.ts');
  handler = fronteiras.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

const chamar = () => handler(new Request('http://localhost', {
  method: 'POST', body: JSON.stringify({ question_id: 13683232817, text: 'Olá' }),
}));

describe('responder-pergunta — anúncio inativo', () => {
  it('400 not_active_item do ML → 409 com orientação de reativar o anúncio', async () => {
    fronteiras.responder.mockRejectedValueOnce(new Error('ML /answers 400: {"message":"Item must be active","error":"not_active_item","status":400,"cause":[]}'));
    const r = await chamar();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      ok: false,
      erro: 'O anúncio não está ativo no Mercado Livre (pausado ou finalizado). Reative o anúncio para responder.',
      codigo: 'anuncio_inativo',
    });
  });

  it('outro erro do ML segue 502 com a mensagem crua', async () => {
    fronteiras.responder.mockRejectedValueOnce(new Error('ML /answers 500: boom'));
    const r = await chamar();
    expect(r.status).toBe(502);
    expect((await r.json()).erro).toBe('ML /answers 500: boom');
  });
});
