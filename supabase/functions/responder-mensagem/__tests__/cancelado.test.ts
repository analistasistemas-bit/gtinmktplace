import { beforeAll, describe, expect, it, vi } from 'vitest';

const fronteiras = vi.hoisted(() => ({
  serve: vi.fn(),
  token: vi.fn(),
  meta: vi.fn(),
  comprador: vi.fn(),
  envio: vi.fn(),
  marcarCancelada: vi.fn().mockResolvedValue(undefined),
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
  marcarConversaCancelada: (...args: unknown[]) => fronteiras.marcarCancelada(...args),
  ERRO_PEDIDO_CANCELADO: 'Não é possível responder porque o pedido foi cancelado.',
  CODIGO_PEDIDO_CANCELADO: 'pedido_cancelado',
}));

let handler: (req: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: fronteiras.serve });
  await import('../index.ts');
  handler = fronteiras.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

describe('responder-mensagem — pedido cancelado', () => {
  it('retorna 409 estruturado e persiste cancelamento sem renovar token, resolver comprador ou enviar', async () => {
    fronteiras.meta.mockResolvedValue({ orderStatus: 'cancelled' });

    const response = await handler(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ pack_id: '123', text: 'Olá' }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      erro: 'Não é possível responder porque o pedido foi cancelado.',
      codigo: 'pedido_cancelado',
    });
    expect(fronteiras.marcarCancelada).toHaveBeenCalledWith(expect.anything(), 'org-1', '123', 'owner-1');
    expect(fronteiras.token).not.toHaveBeenCalled();
    expect(fronteiras.comprador).not.toHaveBeenCalled();
    expect(fronteiras.envio).not.toHaveBeenCalled();
  });

  it('quando envio falha com ERRO_PEDIDO_CANCELADO (403 ML), persiste cancelamento e responde 409 estruturado', async () => {
    fronteiras.meta.mockResolvedValue({ orderStatus: 'paid' });
    fronteiras.token.mockResolvedValue('token-ml');
    fronteiras.comprador.mockResolvedValue('buyer-1');
    fronteiras.envio.mockRejectedValue(new Error('Não é possível responder porque o pedido foi cancelado.'));

    const response = await handler(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ pack_id: '456', text: 'Olá' }),
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      ok: false,
      erro: 'Não é possível responder porque o pedido foi cancelado.',
      codigo: 'pedido_cancelado',
    });
    expect(fronteiras.marcarCancelada).toHaveBeenCalledWith(expect.anything(), 'org-1', '456', 'owner-1');
  });
});
