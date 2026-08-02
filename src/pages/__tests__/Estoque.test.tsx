import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => ({ data: ['estoque'], isLoading: false }),
}));
vi.mock('@/hooks/useImageUrl', () => ({ useImageUrl: () => ({ data: null, isError: false }) }));
vi.mock('@/lib/produtos-saldo', async (orig) => ({
  ...(await orig<typeof import('@/lib/produtos-saldo')>()),
  fetchProdutosComSaldo: () => Promise.resolve([produto]),
  fetchCanaisPorProduto: () => Promise.resolve(new Map()),
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
  it('busca por GTIN encontra o produto', async () => {
    const user = userEvent.setup();
    renderEstoque();
    await screen.findByText('Protetor Solar');
    await user.type(screen.getByPlaceholderText(/Buscar por nome/), '4005800241901');
    expect(screen.getByText('Protetor Solar')).toBeInTheDocument();
  });

  it('busca que não casa mostra a mensagem de vazio', async () => {
    const user = userEvent.setup();
    renderEstoque();
    await screen.findByText('Protetor Solar');
    await user.type(screen.getByPlaceholderText(/Buscar por nome/), 'zzzz');
    expect(screen.getByText(/Nenhum produto bate com/)).toBeInTheDocument();
  });

  it('não renderiza nenhuma <table>', async () => {
    renderEstoque();
    await screen.findByText('Protetor Solar');
    expect(document.querySelectorAll('table')).toHaveLength(0);
  });
});
