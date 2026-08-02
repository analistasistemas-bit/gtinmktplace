import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Estoque from '../Estoque';
import type { ProdutoComSaldo } from '@/lib/produtos-saldo';

const produto: ProdutoComSaldo = {
  codigoPai: '00000004', nomePai: 'Protetor Solar', descricaoPai: null,
  capaStoragePath: null, fornecedor: 'Eucerin', unidade: 'UN', origem: 'nacional',
  mlItemId: null, criadoEm: '2026-08-01T10:00:00Z', saldoTotal: 20,
  variacoes: [{
    codigo: '00000005', nome: null, cor: 'incolor', gtin: '4005800241901', estoque: 20,
    custo: 12, preco: 89.9, pesoGramas: null, alturaCm: null, larguraCm: null,
    comprimentoCm: null, imagemPath: null,
  }],
};

// vi.fn() (não Promise inline): o teste de canais em erro precisa rejeitar só nesse caso,
// sem afetar os demais testes deste arquivo.
const fetchCanaisPorProdutoMock = vi.fn(() => Promise.resolve(new Map<string, string[]>()));

vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => ({ data: ['estoque'], isLoading: false }),
}));
vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null, isError: false }) }));
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  fetchProdutosComSaldo: () => Promise.resolve([produto]),
  fetchCanaisPorProduto: () => fetchCanaisPorProdutoMock(),
}));

function renderEstoque() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><Estoque /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Estoque', () => {
  afterEach(() => {
    fetchCanaisPorProdutoMock.mockReset();
    fetchCanaisPorProdutoMock.mockImplementation(() => Promise.resolve(new Map()));
  });

  it('busca por GTIN encontra o produto', async () => {
    const user = userEvent.setup();
    renderEstoque();
    await screen.findByText('Protetor Solar');
    await user.type(screen.getByPlaceholderText(/Buscar por nome/), '4005800241901');
    expect(screen.getByText('Protetor Solar')).toBeInTheDocument();
  });

  it('busca que não casa mostra a mensagem de vazio com o termo', async () => {
    const user = userEvent.setup();
    renderEstoque();
    await screen.findByText('Protetor Solar');
    await user.type(screen.getByPlaceholderText(/Buscar por nome/), 'zzzz');
    expect(screen.getByText(/Nenhum produto bate com/)).toBeInTheDocument();
  });

  // Achado 1 (revisão final): a mensagem antiga citava o termo mesmo quando o vazio veio do
  // filtro, sem busca nenhuma — "Nenhum produto bate com "".", que não diz nada ao operador.
  it('filtro sem resultado (sem busca) mostra mensagem sobre o filtro, não sobre um termo vazio', async () => {
    const user = userEvent.setup();
    renderEstoque();
    await screen.findByText('Protetor Solar');
    // O único produto do mock tem saldo 20 — "Sem estoque" zera a lista sem envolver a busca.
    await user.click(screen.getByRole('button', { name: 'Sem estoque' }));
    expect(screen.getByText('Nenhum produto encontrado com o filtro selecionado.')).toBeInTheDocument();
    expect(screen.queryByText(/bate com/)).not.toBeInTheDocument();
  });

  it('não renderiza nenhuma <table>', async () => {
    renderEstoque();
    await screen.findByText('Protetor Solar');
    expect(document.querySelectorAll('table')).toHaveLength(0);
  });

  // Achado 2 (revisão final, guarda que a spec §7 já exigia): isLoading e isError da query de
  // canais eram colapsados num único booleano — a UI mostrava a mensagem de ERRO durante o
  // estado transitório de loading, o que é factualmente falso.
  it('canais em erro: opção "não publicado" fica desabilitada, o erro aparece, e uma seleção prévia cai para "todos" com aviso', async () => {
    const user = userEvent.setup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Semeia a query já resolvida, para poder selecionar "não publicado" antes de forçar o erro
    // — a opção fica desabilitada durante loading/erro, então só dá pra clicar nela com sucesso.
    qc.setQueryData(['canais-por-produto'], new Map());
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><Estoque /></MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Protetor Solar');

    await user.click(screen.getByRole('button', { name: 'Não publicado' }));
    expect(screen.getByRole('button', { name: 'Não publicado' })).toHaveAttribute('data-variant', 'secondary');

    fetchCanaisPorProdutoMock.mockRejectedValueOnce(new Error('falhou ao carregar canais'));
    await qc.refetchQueries({ queryKey: ['canais-por-produto'] });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Não publicado' })).toBeDisabled();
    });
    expect(screen.getByText(/não foi possível carregar os canais/i)).toBeInTheDocument();
    // Caiu de volta para "todos" — a seleção anterior não sobrevive a um filtro que a UI sabe
    // que responderia errado.
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('data-variant', 'secondary');
  });
});
