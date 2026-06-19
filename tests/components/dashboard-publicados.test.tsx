import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPublicados } from '@/components/dashboard-publicados';
import type { Periodo } from '@/lib/metricas';

// metricas.ts importa supabase (que lança sem env) — mock como nos demais testes.
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

function setup(periodo: Periodo, onPeriodo = vi.fn()) {
  render(
    <MemoryRouter>
      <DashboardPublicados
        itens={[]}
        totais={{ faturamento: 606.8, unidades: 36, pedidos: 24 }}
        periodo={periodo}
        onPeriodo={onPeriodo}
      />
    </MemoryRouter>,
  );
  return { onPeriodo };
}

describe('DashboardPublicados', () => {
  it('o card Faturamento é um link para /publicados/vendas com o período', () => {
    setup({ tipo: 'preset', dias: 30 });
    const link = screen.getByRole('link', { name: /faturamento/i });
    expect(link.getAttribute('href')).toContain('/publicados/vendas');
    expect(link.getAttribute('href')).toContain('dias=30');
  });

  it('ao clicar em Personalizado mostra os campos De/Até', async () => {
    const { onPeriodo } = setup({ tipo: 'preset', dias: 30 });
    await userEvent.click(screen.getByRole('button', { name: /personalizado/i }));
    expect(onPeriodo).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'range' }));
  });

  it('no modo range, renderiza os inputs de data', () => {
    setup({ tipo: 'range', desde: '2026-05-01', ate: '2026-05-31' });
    expect(screen.getByLabelText(/de/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/até/i)).toBeInTheDocument();
  });
});
