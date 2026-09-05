import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AtualizacaoDisponivel } from '../atualizacao-disponivel';
import { usePwaStore } from '@/stores/pwa-store';

const toastMock = vi.fn((..._args: unknown[]) => 'toast-id');
const dismissMock = vi.fn();
vi.mock('sonner', () => ({
  toast: Object.assign((...args: unknown[]) => toastMock(...args), {
    dismiss: (...args: unknown[]) => dismissMock(...args),
  }),
}));

afterEach(() => {
  cleanup();
  usePwaStore.setState({ needRefresh: false, offlineReady: false, updateSW: null });
  toastMock.mockClear();
  dismissMock.mockClear();
});

describe('AtualizacaoDisponivel', () => {
  it('não mostra nada enquanto não há versão nova', () => {
    render(<AtualizacaoDisponivel />);

    expect(toastMock).not.toHaveBeenCalled();
  });

  it('dispara o toast de nova versão, sem duração, quando needRefresh vira true', () => {
    usePwaStore.setState({ needRefresh: true });

    render(<AtualizacaoDisponivel />);

    expect(toastMock).toHaveBeenCalledTimes(1);
    const [mensagem, opcoes] = toastMock.mock.calls[0] as [string, { duration: number }];
    expect(mensagem).toMatch(/nova versão/i);
    expect(opcoes.duration).toBe(Infinity);
  });

  it('a ação do toast chama updateSW(true), forçando a troca de versão', () => {
    const updateSW = vi.fn().mockResolvedValue(undefined);
    usePwaStore.setState({ needRefresh: true, updateSW });

    render(<AtualizacaoDisponivel />);

    const [, opcoes] = toastMock.mock.calls[0] as [string, { action: { onClick: () => void } }];
    opcoes.action.onClick();

    expect(updateSW).toHaveBeenCalledWith(true);
  });
});
