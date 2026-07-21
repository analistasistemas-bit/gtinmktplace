import { describe, it, expect, vi } from 'vitest';

// Mesmo padrão de src/hooks/__tests__/useMensagens.test.ts: mocka o client e testa a lógica
// (tratamento de erro/exceção) sem montar o hook/react-query.
const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

const { buscarNotificacoes, contarNotificacoesNaoLidas, marcarNotificacoesLidas } = await import('../notificacoes');

// Chain que resolve `resultado` em qualquer ponto (select/order/limit/eq), como o
// PostgrestFilterBuilder real (thenable a qualquer passo da cadeia).
function fakeChain(resultado: unknown) {
  const chain: any = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    eq: () => chain,
    then: (resolve: any) => Promise.resolve(resultado).then(resolve),
  };
  return chain;
}

describe('buscarNotificacoes', () => {
  it('retorna as linhas', async () => {
    const linhas = [{ id: '1', categoria: 'vendas', texto: 'oi', lida: false, criada_em: '2026-07-21' }];
    mockFrom.mockReturnValue(fakeChain({ data: linhas, error: null }));
    expect(await buscarNotificacoes()).toEqual(linhas);
  });

  it('erro → lança', async () => {
    mockFrom.mockReturnValue(fakeChain({ data: null, error: { message: 'boom' } }));
    await expect(buscarNotificacoes()).rejects.toThrow('boom');
  });
});

describe('contarNotificacoesNaoLidas', () => {
  it('retorna a contagem', async () => {
    mockFrom.mockReturnValue(fakeChain({ count: 5, error: null }));
    expect(await contarNotificacoesNaoLidas()).toBe(5);
  });

  it('error não-nulo → 0', async () => {
    mockFrom.mockReturnValue(fakeChain({ count: null, error: { message: 'boom' } }));
    expect(await contarNotificacoesNaoLidas()).toBe(0);
  });

  it('exceção lançada → 0', async () => {
    mockFrom.mockImplementation(() => { throw new Error('network'); });
    expect(await contarNotificacoesNaoLidas()).toBe(0);
  });
});

describe('marcarNotificacoesLidas', () => {
  it('chama a RPC com os ids e retorna quantas marcou', async () => {
    mockRpc.mockResolvedValueOnce({ data: 3, error: null });
    expect(await marcarNotificacoesLidas(['a', 'b'])).toBe(3);
    expect(mockRpc).toHaveBeenCalledWith('marcar_notificacoes_lidas', { p_ids: ['a', 'b'] });
  });

  it('sem ids → não manda p_ids (usa o default do banco = marca todas)', async () => {
    mockRpc.mockResolvedValueOnce({ data: 7, error: null });
    await marcarNotificacoesLidas();
    expect(mockRpc).toHaveBeenCalledWith('marcar_notificacoes_lidas', {});
  });

  it('error não-nulo → 0', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    expect(await marcarNotificacoesLidas()).toBe(0);
  });

  it('exceção lançada → 0', async () => {
    mockRpc.mockRejectedValueOnce(new Error('network'));
    expect(await marcarNotificacoesLidas()).toBe(0);
  });
});
