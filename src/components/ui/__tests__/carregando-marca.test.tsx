import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { CarregandoMarca } from '../carregando-marca';

describe('CarregandoMarca', () => {
  it('logo da marca com status acessível e a mensagem do que está sendo lido', () => {
    render(<CarregandoMarca rotulo="Carregando campanhas" mensagem="Lendo as campanhas no Mercado Livre…" />);
    const status = screen.getByRole('status', { name: 'Carregando campanhas' });
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('PubliAI')).toBeInTheDocument();
    expect(screen.getByText('Lendo as campanhas no Mercado Livre…')).toBeInTheDocument();
    expect(screen.queryByText(/pode levar alguns segundos/)).not.toBeInTheDocument();
  });

  it('espera longa: depois de 6 s avisa que a primeira leitura demora', () => {
    vi.useFakeTimers();
    try {
      render(<CarregandoMarca rotulo="Carregando" mensagem="Calculando…" />);
      act(() => { vi.advanceTimersByTime(6000); });
      expect(screen.getByText('A primeira leitura pode levar alguns segundos.')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
