import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// faturamento.ts (importado pela página via useVendas) puxa supabase, que lança sem env — mock.
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

vi.mock('@/hooks/useVendas', () => ({
  useVendas: () => ({
    data: [
      {
        id: 'v1', order_id: 1, status: 'paid', total_amount: 90.2, is_publiai: true,
        itens: [{ id: 'i1', ml_item_id: 'MLB1', titulo: 'LINHA LINHANYL 150', codigo: '01', ean: '789', quantity: 2, unit_price: 45.1, is_publiai: true }],
      },
      {
        id: 'v2', order_id: 2, status: 'paid', total_amount: 62.5, is_publiai: false,
        itens: [{ id: 'i2', ml_item_id: 'MLBX', titulo: 'Fita Externa', codigo: null, ean: null, quantity: 5, unit_price: 12.5, is_publiai: false }],
      },
    ],
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import DetalheVendas from '@/pages/DetalheVendas';

describe('DetalheVendas', () => {
  it('mostra total, as duas seções e os títulos', () => {
    render(
      <MemoryRouter initialEntries={['/publicados/vendas?dias=30']}>
        <DetalheVendas />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /Detalhe de vendas/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Seus anúncios/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fora do PubliAI/i).length).toBeGreaterThan(0);
    expect(screen.getByText('LINHA LINHANYL 150')).toBeInTheDocument();
    expect(screen.getByText('Fita Externa')).toBeInTheDocument();
  });
});
