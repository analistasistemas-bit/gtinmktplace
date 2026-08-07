import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MovimentosEstoque } from '@/components/movimentos-estoque';
import { QK } from '@/lib/queries';
import type { MovimentoEstoque, PaginaMovimentos } from '@/lib/movimentos-estoque';

const fetchMock = vi.fn();

vi.mock('@/lib/movimentos-estoque', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/movimentos-estoque')>();
  return {
    ...actual,
    fetchMovimentosEstoque: (...args: Parameters<typeof actual.fetchMovimentosEstoque>) =>
      fetchMock(...args),
  };
});

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

function pagina(itens: MovimentoEstoque[], total: number): PaginaMovimentos {
  return { itens, total };
}

function renderLista(variacoes: { codigo: string; cor: string | null }[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MovimentosEstoque codigoPai="00000004" ativo variacoes={variacoes} />
    </QueryClientProvider>,
  );
  return qc;
}

describe('MovimentosEstoque', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(pagina([mov(0)], 1));
  });

  it('abre sem filtro de data e na primeira página', async () => {
    renderLista();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [codigoPai, pag, tam, filtro] = fetchMock.mock.calls[0];
    expect(codigoPai).toBe('00000004');
    expect(pag).toBe(1);
    expect(tam).toBe(20);
    expect(filtro.janela ?? null).toBeNull();
    expect(filtro.grupos ?? []).toEqual([]);
  });

  // A trava contra o defeito de origem: lista cortada em silêncio parece o histórico inteiro.
  it('mostra o total mesmo quando a página é menor que ele', async () => {
    fetchMock.mockResolvedValue(pagina(Array.from({ length: 20 }, (_, i) => mov(i)), 956));
    renderLista();
    expect(await screen.findByText(/de 956 movimentos/i)).toBeInTheDocument();
  });

  it('filtrar por Entradas recorta a busca e volta para a página 1', async () => {
    fetchMock.mockResolvedValue(pagina(Array.from({ length: 20 }, (_, i) => mov(i)), 956));
    renderLista();
    await screen.findByText(/de 956 movimentos/i);

    // Com 48 páginas, a janela de `<Pagination>` a partir da página 1 mostra 1, 2, …, 48 — a 3 só
    // aparece perto da atual. "Página 2" é a próxima visível e já serve para sair da página 1.
    await userEvent.click(await screen.findByRole('button', { name: 'Página 2' }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)![1]).toBe(2));

    await userEvent.click(screen.getByRole('button', { name: 'Entradas' }));
    await waitFor(() => {
      const [, pag, , filtro] = fetchMock.mock.calls.at(-1)!;
      expect(pag).toBe(1);
      expect(filtro.grupos).toEqual(['entradas']);
    });
  });

  it('a entrada antiga aparece ao filtrar, num produto cheio de vendas recentes', async () => {
    fetchMock.mockImplementation((_c: string, _p: number, _t: number, f: { grupos?: string[] }) =>
      Promise.resolve(
        f?.grupos?.[0] === 'entradas'
          ? pagina([mov(55, { motivo: 'entrada', quantidade: 20, documento: 'entrada inicial' })], 1)
          : pagina(Array.from({ length: 20 }, (_, i) => mov(i)), 956),
      ));
    renderLista();
    await screen.findByText(/de 956 movimentos/i);

    await userEvent.click(screen.getByRole('button', { name: 'Entradas' }));

    expect(await screen.findByText('Entrada')).toBeInTheDocument();
    expect(screen.getByText(/entrada inicial/)).toBeInTheDocument();
  });

  it('inverter a ordem pela coluna Data refaz a busca', async () => {
    renderLista();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: /data/i }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)![3].ordem).toBe('antigos'));
  });

  it('filtro sem resultado avisa que é dos filtros, não do produto', async () => {
    fetchMock.mockResolvedValue(pagina([], 0));
    renderLista();
    await userEvent.click(await screen.findByRole('button', { name: 'Estornos' }));
    expect(await screen.findByText(/nenhum movimento com esses filtros/i)).toBeInTheDocument();
  });

  it('produto sem movimento nenhum tem mensagem própria', async () => {
    fetchMock.mockResolvedValue(pagina([], 0));
    renderLista();
    expect(await screen.findByText(/nenhum movimento registrado/i)).toBeInTheDocument();
  });

  it('o filtro de SKU só existe com mais de uma variação', async () => {
    renderLista([{ codigo: '00000005', cor: null }]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByLabelText('Variação')).not.toBeInTheDocument();
  });

  // Regressão: o dialog de entrada invalida pela chave-prefixo. Se ela deixar de casar com as
  // páginas, registrar uma entrada não atualiza a lista e o operador vê saldo velho.
  it('recarrega quando a entrada invalida pela chave-prefixo', async () => {
    const qc = renderLista();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await qc.invalidateQueries({ queryKey: QK.movimentosEstoque('00000004') });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
