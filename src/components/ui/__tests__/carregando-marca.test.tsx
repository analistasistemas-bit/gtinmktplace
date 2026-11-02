import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { CarregandoMarca } from '../carregando-marca';

describe('CarregandoMarca', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('logo da marca com status acessível e a mensagem do que está sendo lido', () => {
    render(<CarregandoMarca rotulo="Carregando campanhas" mensagem="Lendo as campanhas no Mercado Livre…" atrasoMs={0} />);
    const status = screen.getByRole('status', { name: 'Carregando campanhas' });
    // sem aria-busy: o leitor de tela pode adiar o anúncio do aviso de 6 s até busy=false, que nunca chega (Codex)
    expect(status).not.toHaveAttribute('aria-busy');
    expect(screen.getByLabelText('PubliAI')).toBeInTheDocument();
    expect(screen.getByText('Lendo as campanhas no Mercado Livre…')).toBeInTheDocument();
    expect(screen.queryByText(/pode levar alguns segundos/)).not.toBeInTheDocument();
  });

  it('carga rápida não pisca: nada aparece antes de 300 ms', () => {
    render(<CarregandoMarca rotulo="Carregando" mensagem="Lendo…" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(299); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('status', { name: 'Carregando' })).toBeInTheDocument();
  });

  it('espera longa: depois de 6 s avisa que a primeira leitura demora', () => {
    render(<CarregandoMarca rotulo="Carregando" mensagem="Calculando…" />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByText('A primeira leitura pode levar alguns segundos.')).toBeInTheDocument();
  });

  it('variante compacta: sem borda de painel nem altura mínima, logo pequena', () => {
    render(<CarregandoMarca rotulo="Carregando" mensagem="Lendo…" atrasoMs={0} variante="compacta" />);
    const status = screen.getByRole('status');
    expect(status.className).not.toMatch(/border-dashed|min-h-72/);
    expect(status.querySelector('.h-8')).not.toBeNull();
  });

  it('variante tela: ocupa a tela inteira, sem borda', () => {
    render(<CarregandoMarca rotulo="Carregando" mensagem="Abrindo o PubliAI…" atrasoMs={0} variante="tela" />);
    const status = screen.getByRole('status');
    expect(status.className).toMatch(/min-h-screen/);
    expect(status.className).not.toMatch(/border-dashed/);
  });
});
