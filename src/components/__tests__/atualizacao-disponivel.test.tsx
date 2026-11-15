import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AtualizacaoDisponivel } from '../atualizacao-disponivel';
import { usePwaStore } from '@/stores/pwa-store';
import { jaAvisouHoje, marcarAvisadoHoje } from '@/lib/aviso-versao-dia';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  usePwaStore.setState({ needRefresh: false, offlineReady: false, updateSW: null, sinalVersao: 0 });
});

const cartao = () => screen.queryByText(/nova versão do publiai pronta/i);

describe('AtualizacaoDisponivel (selo + aviso do dia, ADR-0153 D4)', () => {
  it('não mostra nada enquanto não há versão nova', () => {
    render(<AtualizacaoDisponivel />);

    expect(screen.queryByRole('button', { name: /nova versão/i })).toBeNull();
  });

  it('na 1ª vez do dia abre o aviso e marca o dia como avisado', () => {
    usePwaStore.setState({ needRefresh: true });

    render(<AtualizacaoDisponivel />);

    expect(cartao()).not.toBeNull();
    expect(jaAvisouHoje()).toBe(true);
  });

  it('se já avisou hoje, mostra só o selo, sem abrir o aviso', () => {
    marcarAvisadoHoje();
    usePwaStore.setState({ needRefresh: true });

    render(<AtualizacaoDisponivel />);

    expect(screen.getByRole('button', { name: /nova versão/i })).toBeTruthy();
    expect(cartao()).toBeNull();
  });

  it('"Agora não" recolhe para o selo e clicar no selo reabre', async () => {
    const user = userEvent.setup();
    usePwaStore.setState({ needRefresh: true });
    render(<AtualizacaoDisponivel />);

    await user.click(screen.getByRole('button', { name: /agora não/i }));
    expect(cartao()).toBeNull();

    await user.click(screen.getByRole('button', { name: /nova versão/i }));
    expect(cartao()).not.toBeNull();
  });

  it('abrir sozinho não tira o foco de quem está digitando', () => {
    render(<input aria-label="campo" />);
    const campo = screen.getByLabelText('campo');
    campo.focus();

    act(() => usePwaStore.setState({ needRefresh: true, sinalVersao: 1 }));
    render(<AtualizacaoDisponivel />);

    expect(cartao()).not.toBeNull();
    expect(document.activeElement).toBe(campo);
  });

  it('com o app aberto na virada do dia, voltar para a aba reabre o aviso', async () => {
    const user = userEvent.setup();
    usePwaStore.setState({ needRefresh: true });
    render(<AtualizacaoDisponivel />);
    await user.click(screen.getByRole('button', { name: /agora não/i }));
    expect(cartao()).toBeNull();

    localStorage.clear(); // equivale a "ainda não avisou no dia novo"
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(cartao()).not.toBeNull();
  });

  it('"Atualizar agora" chama updateSW(true)', async () => {
    const user = userEvent.setup();
    const updateSW = vi.fn().mockResolvedValue(undefined);
    usePwaStore.setState({ needRefresh: true, updateSW });
    render(<AtualizacaoDisponivel />);

    await user.click(screen.getByRole('button', { name: /atualizar agora/i }));

    expect(updateSW).toHaveBeenCalledWith(true);
  });
});

describe('aviso-versao-dia', () => {
  it('vale só para o dia corrente', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 15, 23, 59));
    marcarAvisadoHoje();
    expect(jaAvisouHoje()).toBe(true);

    vi.setSystemTime(new Date(2026, 10, 16, 0, 1));
    expect(jaAvisouHoje()).toBe(false);
  });
});
