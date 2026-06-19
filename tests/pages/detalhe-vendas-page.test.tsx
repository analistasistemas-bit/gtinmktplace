import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// metricas.ts (importado pela página) puxa supabase, que lança sem env — mock.
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

vi.mock('@/hooks/useMetricasVendas', () => ({
  useMetricasVendas: () => ({
    data: {
      porItem: { MLB1: { unidades: 2, valor: 90.2 } },
      totais: { faturamento: 606.8, unidades: 36, pedidos: 24 },
      externos: [{ id: 'MLBX', titulo: 'Fita Externa', unidades: 5, valor: 62.5 }],
    },
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/usePublicados', () => ({
  usePublicados: () => ({ data: [{ mlItemId: 'MLB1', titulo: 'LINHA LINHANYL 150' }] }),
}));

import DetalheVendas from '@/pages/DetalheVendas';

describe('DetalheVendas', () => {
  it('mostra total, as duas seções e os títulos', () => {
    render(
      <MemoryRouter initialEntries={['/publicados/vendas?dias=30']}>
        <DetalheVendas />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Detalhe de vendas/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Seus anúncios/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Fora do PubliAI/i).length).toBeGreaterThan(0);
    expect(screen.getByText('LINHA LINHANYL 150')).toBeInTheDocument();
    expect(screen.getByText('Fita Externa')).toBeInTheDocument();
  });
});
