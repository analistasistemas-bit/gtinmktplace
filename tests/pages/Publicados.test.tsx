import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Publicados from '@/pages/Publicados';
import type { PublicadoItem } from '@/lib/publicados';

const usePublicadosMock = vi.fn();
const useStatusPublicadosMock = vi.fn();
const useRemoverPublicadoMock = vi.fn();
const useMetricasVendasMock = vi.fn();
const useResumoFinanceiroMock = vi.fn();
const useVendasMock = vi.fn();
const useCustosMock = vi.fn();

vi.mock('@/hooks/usePublicados', () => ({
  usePublicados: () => usePublicadosMock(),
}));

vi.mock('@/hooks/useVendas', () => ({
  useVendas: () => useVendasMock(),
}));

vi.mock('@/hooks/useCustos', () => ({
  useCustos: () => useCustosMock(),
}));

vi.mock('@/hooks/useStatusPublicados', () => ({
  useStatusPublicados: () => useStatusPublicadosMock(),
}));

vi.mock('@/hooks/useRemoverPublicado', () => ({
  useRemoverPublicado: () => useRemoverPublicadoMock(),
}));

vi.mock('@/hooks/useMetricasVendas', () => ({
  useMetricasVendas: () => useMetricasVendasMock(),
}));

vi.mock('@/hooks/useResumoFinanceiro', () => ({
  useResumoFinanceiro: () => useResumoFinanceiroMock(),
}));

function itemBase(over: Partial<PublicadoItem> = {}): PublicadoItem {
  return {
    familiaId: 'f1',
    codigoPai: '01829149',
    titulo: 'COLA LIQUIDA SILICONE 250ML',
    fornecedor: 'BUFALO',
    tipo: 'cola',
    categoria: null,
    precoPublicacao: 24.1,
    descricao: 'descricao',
    mlItemId: 'MLB1',
    mlPermalink: 'https://example.com/mlb1',
    publicadoEm: '2026-06-12T12:36:04.408Z',
    status: 'ativo',
    estoque: 87,
    precoAtual: 24.1,
    motivo: null,
    ...over,
  };
}

describe('Publicados', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    usePublicadosMock.mockReturnValue({
      data: [itemBase()],
      isLoading: false,
      error: null,
    });
    useStatusPublicadosMock.mockReturnValue({
      data: { itens: [] },
      isFetching: false,
      refetch: vi.fn(),
    });
    useRemoverPublicadoMock.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
    });
    useMetricasVendasMock.mockReturnValue({
      data: { porItem: {}, totais: { faturamento: 0, unidades: 0, pedidos: 0 } },
      isFetching: false,
      refetch: vi.fn(),
    });
    useResumoFinanceiroMock.mockReturnValue({
      data: { semCredencialMP: true },
      isFetching: false,
      refetch: vi.fn(),
    });
    useVendasMock.mockReturnValue({
      data: [],
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    useCustosMock.mockReturnValue({ data: undefined });
  });

  it('mostra o tipo cola na tabela', () => {
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    expect(screen.getByRole('cell', { name: 'Cola' })).toBeInTheDocument();
  });

  it('oferece Cola no filtro de tipos', () => {
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getAllByRole('combobox')[2]);

    expect(screen.getByRole('option', { name: 'Cola' })).toBeInTheDocument();
  });

  it('exibe a categoria real do ML em vez de "Outro" quando a IA a resolveu', () => {
    usePublicadosMock.mockReturnValue({
      data: [itemBase({ tipo: 'outro', categoria: 'Alfinetes de Segurança' })],
      isLoading: false,
      error: null,
    });
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );

    expect(screen.getByRole('cell', { name: 'Alfinetes de Segurança' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: 'Outro' })).not.toBeInTheDocument();
  });

  it('mostra a ponte de líquido linkando para o Financeiro quando há dados', () => {
    // A ponte deriva de calcularResumo(vendas) (ADR-0038): líquido = soma de ml_vendas.liquido.
    useVendasMock.mockReturnValue({
      data: [{
        id: 'v1', order_id: 1, status: 'paid', total_amount: 606.8, liquido: 364.46,
        estorno: null, pack_id: null, shipping_id: null, frete_vendedor: null, itens: [],
      }],
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
    render(
      <MemoryRouter>
        <Publicados />
      </MemoryRouter>,
    );
    const ponte = screen.getByRole('link', { name: /Líquido das vendas/i });
    expect(ponte).toHaveAttribute('href', '/financeiro');
    expect(ponte).toHaveTextContent('R$ 364,46');
  });
});
