import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSessionState } from '@/hooks/useSessionState';

afterEach(() => sessionStorage.clear());

describe('useSessionState', () => {
  it('usa o valor inicial quando não há nada salvo', () => {
    const { result } = renderHook(() => useSessionState('k', { key: 'valor', dir: 'desc' }));
    expect(result.current[0]).toEqual({ key: 'valor', dir: 'desc' });
  });

  it('persiste em sessionStorage e sobrevive a um remount (chave igual)', () => {
    const { result, unmount } = renderHook(() => useSessionState<unknown>('sort:x', null));
    act(() => result.current[1]({ key: 'markup', dir: 'asc' }));
    expect(JSON.parse(sessionStorage.getItem('sort:x')!)).toEqual({ key: 'markup', dir: 'asc' });
    unmount();

    // Remontar (troca de aba / navegação) deve recuperar a ordenação salva, não voltar ao inicial.
    const remount = renderHook(() => useSessionState<unknown>('sort:x', null));
    expect(remount.result.current[0]).toEqual({ key: 'markup', dir: 'asc' });
  });

  it('aceita updater funcional', () => {
    const { result } = renderHook(() => useSessionState('n', 1));
    act(() => result.current[1]((v) => v + 1));
    expect(result.current[0]).toBe(2);
    expect(JSON.parse(sessionStorage.getItem('n')!)).toBe(2);
  });
});
