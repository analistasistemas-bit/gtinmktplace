import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLotes, useLote } from '@/hooks/useLotes';

describe('useLotes', () => {
  it('retorna lista de lotes', () => {
    const { result } = renderHook(() => useLotes());
    expect(result.current.length).toBeGreaterThanOrEqual(6);
  });
});

describe('useLote', () => {
  it('retorna o lote com o id fornecido', () => {
    const { result } = renderHook(() => useLote('lote-42'));
    expect(result.current).toBeDefined();
    expect(result.current?.numero).toBe(42);
  });

  it('retorna undefined para id desconhecido', () => {
    const { result } = renderHook(() => useLote('nao-existe'));
    expect(result.current).toBeUndefined();
  });
});
