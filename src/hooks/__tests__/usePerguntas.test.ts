import { describe, it, expect, vi } from 'vitest';

// Mesmo padrão de useMensagens/notificacoes: mocka o client e testa a função de contagem
// (tratamento de erro) sem montar o hook/react-query.
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mockFrom },
}));

const { contarPerguntasNaoRespondidas } = await import('../usePerguntas');

function fakeChain(resultado: unknown) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    then: (resolve: any) => Promise.resolve(resultado).then(resolve),
  };
  return chain;
}

describe('contarPerguntasNaoRespondidas', () => {
  it('retorna a contagem de não respondidas', async () => {
    mockFrom.mockReturnValue(fakeChain({ count: 4, error: null }));
    expect(await contarPerguntasNaoRespondidas()).toBe(4);
  });

  it('count null → 0', async () => {
    mockFrom.mockReturnValue(fakeChain({ count: null, error: null }));
    expect(await contarPerguntasNaoRespondidas()).toBe(0);
  });

  it('error não-nulo → lança (o hook expõe isError; badge distingue de "0")', async () => {
    mockFrom.mockReturnValue(fakeChain({ count: null, error: { message: 'boom' } }));
    await expect(contarPerguntasNaoRespondidas()).rejects.toThrow('boom');
  });
});
