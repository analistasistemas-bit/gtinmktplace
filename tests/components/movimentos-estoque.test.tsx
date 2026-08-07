import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MovimentosEstoque } from '@/components/movimentos-estoque';
import { QK } from '@/lib/queries';
import type { MovimentoEstoque } from '@/lib/movimentos-estoque';

const fetchMock = vi.fn();

vi.mock('@/lib/movimentos-estoque', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/movimentos-estoque')>();
  return {
    ...actual,
    fetchMovimentosEstoque: (...args: Parameters<typeof actual.fetchMovimentosEstoque>) =>
      fetchMock(...args),
  };
});

// O ledger é sempre lido do mais novo para o mais antigo; `i` cresce = movimento mais antigo.
function mov(i: number, over: Partial<MovimentoEstoque> = {}): MovimentoEstoque {
  return {
    id: `m${i}`,
    criado_em: new Date(Date.UTC(2026, 7, 7, 12, 0, 0) - i * 60_000).toISOString(),
    codigo: '00000005',
    quantidade: -1,
    quantidade_pedida: 1,
    motivo: 'venda',
    canal_origem: 'mercado_livre',
    documento: null,
    estoque_anterior: 60 - i,
    estoque_resultante: 59 - i,
    ...over,
  };
}

function renderLista() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MovimentosEstoque codigoPai="00000004" ativo />
    </QueryClientProvider>,
  );
  return qc;
}

describe('MovimentosEstoque', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  // Regressão (incidente 2026-08-07): o protetor solar tinha 56 movimentos e a lista buscava só
  // os 20 mais recentes — todos vendas. As duas entradas (a inicial, a mais antiga do ledger, e a
  // reposição de 05/08) ficavam fora, e nada na tela dizia que a lista estava cortada.
  it('mostra as entradas antigas de um produto com dezenas de vendas recentes', async () => {
    const movimentos = [
      ...Array.from({ length: 36 }, (_, i) => mov(i)),
      mov(36, { motivo: 'entrada', quantidade: 40, documento: 'reposição' }),
      ...Array.from({ length: 18 }, (_, i) => mov(37 + i)),
      mov(55, { motivo: 'entrada', quantidade: 20, documento: 'entrada inicial' }),
    ];
    // Fatia como o banco fatiaria: o limite pedido é o que decide o que chega na tela. Sem limite
    // explícito vale o default da lib (20) — que era exatamente o que escondia as entradas.
    fetchMock.mockImplementation((_codigo: string, limite?: number) =>
      Promise.resolve(movimentos.slice(0, limite ?? 20)));

    renderLista();

    await waitFor(() => expect(screen.getAllByText('Entrada')).toHaveLength(2));
    expect(screen.getByText(/entrada inicial/)).toBeInTheDocument();
  });

  it('avisa que a lista está cortada e carrega mais sob demanda', async () => {
    // A busca pede um a mais que o limite justamente para saber que há resto.
    fetchMock.mockResolvedValue(Array.from({ length: 101 }, (_, i) => mov(i)));

    renderLista();

    const botao = await screen.findByRole('button', { name: /carregar mais/i });
    expect(screen.getAllByText('Venda')).toHaveLength(100);

    await userEvent.click(botao);

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith('00000004', 201));
  });

  // A lista virou paginada (chave `[..., codigoPai, limite]`), mas o dialog de entrada invalida pela
  // chave-prefixo `[..., codigoPai]`. Se as duas deixarem de casar, registrar uma entrada não
  // atualiza a lista e o operador vê saldo velho sem nenhum sinal de que está velho.
  it('recarrega quando a entrada invalida a query pela chave-prefixo', async () => {
    fetchMock.mockResolvedValue([mov(0)]);
    const qc = renderLista();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    await qc.invalidateQueries({ queryKey: QK.movimentosEstoque('00000004') });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
