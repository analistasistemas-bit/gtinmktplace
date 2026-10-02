import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
});
