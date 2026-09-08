import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { supabase } from '../supabase';
import { responderMensagem, ehPedidoCancelado } from '../mensagens';

describe('mensagens-erro — tratamento de erro de pedido cancelado', () => {
  beforeEach(() => {
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { access_token: 'tok-test' } },
      error: null,
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('responderMensagem propaga o campo .codigo quando o backend retorna 409 com codigo pedido_cancelado', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        erro: 'Não é possível responder porque o pedido foi cancelado.',
        codigo: 'pedido_cancelado',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    let erroCapturado: unknown;
    try {
      await responderMensagem('pack-123', 'Olá');
    } catch (err) {
      erroCapturado = err;
    }

    expect(erroCapturado).toBeInstanceOf(Error);
    expect((erroCapturado as Error & { codigo?: string }).codigo).toBe('pedido_cancelado');
    expect((erroCapturado as Error).message).toBe('Não é possível responder porque o pedido foi cancelado.');
    expect(ehPedidoCancelado(erroCapturado)).toBe(true);
  });

  describe('ehPedidoCancelado', () => {
    it('retorna true para erro com codigo pedido_cancelado', () => {
      const err = new Error('Falha no envio');
      (err as Error & { codigo?: string }).codigo = 'pedido_cancelado';
      expect(ehPedidoCancelado(err)).toBe(true);
    });

    it('retorna true para erro com message contendo "pedido foi cancelado" (fallback)', () => {
      const err = new Error('Não é possível responder porque o pedido foi cancelado.');
      expect(ehPedidoCancelado(err)).toBe(true);
    });

    it('retorna false para erro comum', () => {
      expect(ehPedidoCancelado(new Error('Erro 500'))).toBe(false);
      expect(ehPedidoCancelado(new Error('Timeout na conexão'))).toBe(false);
    });

    it('retorna false para valores não-Error (null, undefined, string, objeto plano)', () => {
      expect(ehPedidoCancelado(null)).toBe(false);
      expect(ehPedidoCancelado(undefined)).toBe(false);
      expect(ehPedidoCancelado('pedido foi cancelado')).toBe(false);
      expect(ehPedidoCancelado({ codigo: 'pedido_cancelado' })).toBe(false);
      expect(ehPedidoCancelado(409)).toBe(false);
    });
  });
});
