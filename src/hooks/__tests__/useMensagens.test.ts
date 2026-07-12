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
  it('retorna o número da RPC', async () => {
    mockRpc.mockResolvedValueOnce({ data: 3, error: null });
    expect(await contarConversasAguardando()).toBe(3);
  });

  it('error não-nulo → 0', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await contarConversasAguardando()).toBe(0);
  });

  it('exceção lançada → 0', async () => {
    mockRpc.mockRejectedValueOnce(new Error('network'));
    expect(await contarConversasAguardando()).toBe(0);
  });
});
