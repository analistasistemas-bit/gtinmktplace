import { describe, it, expect, vi } from 'vitest';

// Testa a lógica de contarConversasAguardando diretamente (sem montar o hook/react-query) —
// mesmo padrão de src/lib/__tests__/mensagens-conversas.test.ts. Não há precedente de teste de
// hook (renderHook) neste repo; a lógica que importa (RPC + tratamento de erro) foi extraída para
// uma função exportada e testável em src/hooks/useMensagens.ts.
const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: mockRpc },
}));

const { contarConversasAguardando } = await import('../useMensagens');

describe('contarConversasAguardando', () => {
  it('consulta a regra SQL da badge e retorna seu número', async () => {
    mockRpc.mockResolvedValueOnce({ data: 3, error: null });
    expect(await contarConversasAguardando()).toBe(3);
    expect(mockRpc).toHaveBeenCalledWith('contar_conversas_aguardando');
  });

  it('error não-nulo → lança (o hook expõe isError; badge distingue de "0")', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(contarConversasAguardando()).rejects.toThrow('boom');
  });

  it('exceção lançada → propaga', async () => {
    mockRpc.mockRejectedValueOnce(new Error('network'));
    await expect(contarConversasAguardando()).rejects.toThrow('network');
  });
});
