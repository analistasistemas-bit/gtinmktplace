import { afterEach, describe, expect, it, vi } from 'vitest';
import { atualizarApp } from '../atualizar-app';

const reload = vi.fn();

function fakeSw(waiting: { postMessage: ReturnType<typeof vi.fn> } | null) {
  const listeners: Record<string, () => void> = {};
  const sw = {
    getRegistration: vi.fn().mockResolvedValue(waiting === undefined ? undefined : { waiting }),
    addEventListener: vi.fn((tipo: string, fn: () => void) => {
      listeners[tipo] = fn;
    }),
  };
  return { sw, disparar: (tipo: string) => listeners[tipo]?.() };
}

afterEach(() => {
  vi.useRealTimers();
  reload.mockClear();
});

describe('atualizarApp', () => {
  it('com versão esperando: manda SKIP_WAITING e recarrega quando a nova assume', async () => {
    const waiting = { postMessage: vi.fn() };
    const { sw, disparar } = fakeSw(waiting);

    await atualizarApp(sw as never, reload);

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    disparar('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('se a nova versão não assume em 3 s, recarrega mesmo assim', async () => {
    vi.useFakeTimers();
    const { sw } = fakeSw({ postMessage: vi.fn() });

    await atualizarApp(sw as never, reload);
    vi.advanceTimersByTime(3000);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('sem versão esperando (já ativada por outro clique/aba): só recarrega', async () => {
    const { sw } = fakeSw(null);

    await atualizarApp(sw as never, reload);

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
