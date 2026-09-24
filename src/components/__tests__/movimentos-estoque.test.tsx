import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MovimentosEstoque } from '../movimentos-estoque';
import type { MovimentoEstoque } from '@/lib/movimentos-estoque';
import type { VariacaoFiltro } from '@/components/estoque/filtros-movimentos';

const fetchMock = vi.fn();
vi.mock('@/lib/movimentos-estoque', async (orig) => ({
  ...(await orig<typeof import('@/lib/movimentos-estoque')>()),
  fetchMovimentosEstoque: (...a: unknown[]) => fetchMock(...a),
}));

function movimento(over: Partial<MovimentoEstoque> = {}): MovimentoEstoque {
  return {
    id: '1', criado_em: '2026-09-24T12:00:00Z', codigo: '09200001',
    quantidade: 5, quantidade_pedida: null, motivo: 'entrada',
    canal_origem: null, documento: null, estoque_anterior: 0, estoque_resultante: 5,
    ...over,
  };
}

function renderComp(variacoes: VariacaoFiltro[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MovimentosEstoque codigoPai="00000000" ativo variacoes={variacoes} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ itens: [movimento()], total: 1 });
});

// ADR-0166 (Task 3): a linha do movimento ganha "· cor · tamanho" quando a variação da grade
// tem tamanho. INV-1: sem a variação na lista, ou variação sem tamanho, mantém só o código.
describe('MovimentosEstoque — rótulo da variação na linha', () => {
  it('variação com tamanho: código · cor · tamanho', async () => {
    const { container } = renderComp([{ codigo: '09200001', cor: 'Preto', nome: 'Preto', tamanho: 'M' }]);
    await screen.findByText('09200001');
    expect(container.textContent).toContain('09200001 · Preto · M');
  });

  it('sem a variação na lista, mostra só o código (INV-1)', async () => {
    const { container } = renderComp([]);
    await screen.findByText('09200001');
    expect(container.textContent).not.toContain('· Preto');
  });

  it('variação sem tamanho, mostra só o código (INV-1)', async () => {
    const { container } = renderComp([{ codigo: '09200001', cor: 'Preto', nome: 'Preto', tamanho: null }]);
    await screen.findByText('09200001');
    expect(container.textContent).not.toContain('· Preto');
  });
});
