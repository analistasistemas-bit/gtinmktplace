import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { BannerOffline } from '../banner-offline';

afterEach(() => {
  cleanup();
  // Restaura o estado online para não contaminar outros testes (o onlineManager é um singleton).
  onlineManager.setOnline(true);
});

describe('BannerOffline (ADR-0153, D6)', () => {
  it('não mostra nada enquanto há conexão', () => {
    render(<BannerOffline />);

    expect(screen.queryByLabelText('Sem conexão')).not.toBeInTheDocument();
  });

  it('mostra a faixa com a hora da queda quando a conexão cai', () => {
    // Sem hora fixa (ADR: data fixa cruzando fuso é bomba-relógio) — a prova é que uma hora
    // real (HH:MM) aparece no texto, não um valor específico.
    render(<BannerOffline />);

    act(() => onlineManager.setOnline(false));

    const faixa = screen.getByLabelText('Sem conexão');
    expect(faixa).toHaveTextContent(/Sem conexão desde \d{2}:\d{2}/);
    expect(faixa).toHaveTextContent(/valores podem estar desatualizados/i);
  });

  it('some quando a conexão volta', () => {
    render(<BannerOffline />);

    act(() => onlineManager.setOnline(false));
    expect(screen.getByLabelText('Sem conexão')).toBeInTheDocument();

    act(() => onlineManager.setOnline(true));
    expect(screen.queryByLabelText('Sem conexão')).not.toBeInTheDocument();
  });
});
