import { beforeAll, describe, expect, it, vi } from 'vitest';

const fronteiras = vi.hoisted(() => ({
  serve: vi.fn(),
  token: vi.fn(),
  meta: vi.fn(),
  comprador: vi.fn(),
  envio: vi.fn(),
}));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn().mockResolvedValue({ userId: 'user-1', orgId: 'org-1', isAdmin: false, support: null }),
}));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: { criado_por: 'owner-1' }, error: null }),
      };
      return query;
    },
  }),
}));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: vi.fn() }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: fronteiras.token }));
vi.mock('../../_shared/canais/conexao.ts', () => ({
  mapearConexao: () => ({ contaExternaId: 'seller-1' }),
}));
vi.mock('../../_shared/faturamento/mensagens-io.ts', () => ({
  buscarMensagensPack: vi.fn(),
  pedidoCancelado: (status: string | null | undefined) => status === 'cancelled',
  resolverMetaPack: fronteiras.meta,
  responderMensagemPedido: fronteiras.envio,
  resolverCompradorId: fronteiras.comprador,
  upsertMensagens: vi.fn(),
}));

let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: fronteiras.serve });
  await import('../index.ts');
  handler = fronteiras.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

describe('responder-mensagem — pedido cancelado', () => {
  it('retorna 409 sem renovar token, resolver comprador ou enviar', async () => {
    fronteiras.meta.mockResolvedValue({ orderStatus: 'cancelled' });

    const response = await handler(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ pack_id: '123', text: 'Olá' }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, erro: 'Não é possível responder porque o pedido foi cancelado.' });
    expect(fronteiras.token).not.toHaveBeenCalled();
    expect(fronteiras.comprador).not.toHaveBeenCalled();
    expect(fronteiras.envio).not.toHaveBeenCalled();
  });
});
