import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('clicar em Personalizado mostra De/Até e OK, mas NÃO refaz a busca ainda', async () => {
    const { onPeriodo } = setup({ tipo: 'preset', dias: 30 });
    await userEvent.click(screen.getByRole('button', { name: /personalizado/i }));
    expect(screen.getByLabelText(/de/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/até/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ok/i })).toBeInTheDocument();
    // A página só deve atualizar ao confirmar — abrir o modo não dispara onPeriodo.
    expect(onPeriodo).not.toHaveBeenCalled();
  });

  it('alterar as datas não dispara onPeriodo; só o OK aplica o intervalo', async () => {
    const { onPeriodo } = setup({ tipo: 'preset', dias: 30 });
    await userEvent.click(screen.getByRole('button', { name: /personalizado/i }));
    fireEvent.change(screen.getByLabelText(/de/i), { target: { value: '2026-06-01' } });
    fireEvent.change(screen.getByLabelText(/até/i), { target: { value: '2026-06-15' } });
    expect(onPeriodo).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /ok/i }));
    expect(onPeriodo).toHaveBeenCalledTimes(1);
    expect(onPeriodo).toHaveBeenCalledWith({ tipo: 'range', desde: '2026-06-01', ate: '2026-06-15' });
  });

  it('no modo range, renderiza os inputs de data já preenchidos', () => {
    setup({ tipo: 'range', desde: '2026-05-01', ate: '2026-05-31' });
    expect(screen.getByLabelText(/de/i)).toHaveValue('2026-05-01');
    expect(screen.getByLabelText(/até/i)).toHaveValue('2026-05-31');
  });
});
