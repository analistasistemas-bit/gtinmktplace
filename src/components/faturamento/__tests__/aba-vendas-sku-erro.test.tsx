import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AbaVendasSku } from '@/components/faturamento/aba-vendas-sku';

const { refetch } = vi.hoisted(() => ({ refetch: vi.fn() }));
vi.mock('@/hooks/useVendasSku', () => ({
  useVendasSku: () => ({ dados: null, isLoading: false, isFetching: false, isError: true, refetch }),
}));

describe('AbaVendasSku — erro', () => {
  it('falha ao carregar: mensagem e "Tentar de novo" chama refetch', () => {
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><AbaVendasSku /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByText('Não foi possível carregar as vendas por SKU')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(refetch).toHaveBeenCalled();
  });
});
