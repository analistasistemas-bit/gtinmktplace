import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCountUp } from '../use-count-up';

const callbacks = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let reducedMotion = false;

beforeEach(() => {
  reducedMotion = false;
  callbacks.clear();
  nextFrame = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++nextFrame;
    callbacks.set(id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    callbacks.delete(id);
  });
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
    matches: reducedMotion,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useCountUp', () => {
  it('chega ao valor final ao concluir a animação', () => {
    const { result } = renderHook(() => useCountUp(100));
    expect(result.current).toBe(0);

    act(() => callbacks.get(1)?.(0));
    act(() => callbacks.get(2)?.(190));

    expect(result.current).toBe(100);
  });

  it('reinicia a partir do valor atual quando o alvo muda antes de concluir', () => {
    const { result, rerender } = renderHook(({ n }) => useCountUp(n), { initialProps: { n: 100 } });

    // Avança só metade da animação — não deixa concluir antes de trocar o alvo.
    act(() => callbacks.get(1)?.(0));
    act(() => callbacks.get(2)?.(95));
    const parcial = result.current;
    expect(parcial).toBeGreaterThan(0);
    expect(parcial).toBeLessThan(100);

    rerender({ n: 300 });

    // O primeiro frame do novo alvo já deve partir do valor corrente, não de 0.
    const proximoId = nextFrame;
    act(() => callbacks.get(proximoId)?.(96));
    expect(result.current).toBeGreaterThanOrEqual(parcial);

    act(() => callbacks.get(proximoId)?.(96 + 190));
    expect(result.current).toBe(300);
  });

  it('renderiza o valor final diretamente com reduced motion', () => {
    reducedMotion = true;
    const { result } = renderHook(() => useCountUp(100));

    expect(result.current).toBe(100);
    expect(callbacks).toHaveLength(0);
  });
});
