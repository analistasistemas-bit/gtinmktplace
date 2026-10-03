import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const carregar = vi.hoisted(() => vi.fn());
vi.mock('@/lib/vitrine-dados', () => ({ carregarVitrine: carregar }));

import Vitrine from '@/pages/Vitrine';

describe('Vitrine (página)', () => {
  it('carga inicial = 1 chamada; trocar preset = exatamente 1 nova', async () => {
    carregar.mockResolvedValue({ inicio: '', fim: '', itens: [], semanas: [], dias_semana: [] });
    render(<Vitrine />);
    await waitFor(() => expect(screen.getByText('Ainda sem visitas coletadas')).toBeTruthy());
    expect(carregar).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: '12 semanas' }));
    await waitFor(() => expect(screen.getByText('Ainda sem visitas coletadas')).toBeTruthy());
    expect(carregar).toHaveBeenCalledTimes(2);
  });

  it('preenchida: Onde agir com chips e tooltips (sem TooltipProvider externo); período muda o texto', async () => {
    const it = {
      ml_item_id: 'MLB1', titulo: 'FITA CETIM', codigo_pai: '1', status: 'active', em_ads: false,
      visitas: 14, pedidos: 1, receita: 10, pares_ok: 28, pares_total: 28,
      visitas_ant: 20, pedidos_ant: 2, receita_ant: 20, pares_ok_ant: 28, pares_total_ant: 28,
      visitas_ult7: 0, dias_ok_ult7: 7, variacao: null, permalink: null,
    };
    carregar.mockResolvedValue({ inicio: '', fim: '', itens: [it], semanas: [], dias_semana: [] });
    render(<MemoryRouter><Vitrine /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('group', { name: 'Filtrar por rótulo' })).toBeTruthy());
    expect(screen.getAllByText(/em 4 sem/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: '12 semanas' }));
    await waitFor(() => expect(screen.getAllByText(/em 12 sem/).length).toBeGreaterThan(0));
  });
});
