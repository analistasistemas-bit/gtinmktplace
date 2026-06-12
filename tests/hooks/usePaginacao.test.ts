import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePaginacao } from '@/hooks/usePaginacao';

describe('usePaginacao', () => {
  const itens = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12

  it('começa na página 1 com tamanho padrão 5', () => {
    const { result } = renderHook(() => usePaginacao(itens));
    expect(result.current.paginaAtual).toBe(1);
    expect(result.current.tamanho).toBe(5);
    expect(result.current.itensPagina).toEqual([1, 2, 3, 4, 5]);
    expect(result.current.totalPaginas).toBe(3);
  });

  it('navega com proxima/anterior/irPara', () => {
    const { result } = renderHook(() => usePaginacao(itens));
    act(() => result.current.proxima());
    expect(result.current.itensPagina).toEqual([6, 7, 8, 9, 10]);
    act(() => result.current.anterior());
    expect(result.current.paginaAtual).toBe(1);
    act(() => result.current.irPara(3));
    expect(result.current.itensPagina).toEqual([11, 12]);
  });

  it('setTamanho volta para a página 1', () => {
    const { result } = renderHook(() => usePaginacao(itens));
    act(() => result.current.irPara(3));
    act(() => result.current.setTamanho(10));
    expect(result.current.paginaAtual).toBe(1);
    expect(result.current.tamanho).toBe(10);
    expect(result.current.itensPagina).toHaveLength(10);
  });

  it('reset volta para a página 1', () => {
    const { result } = renderHook(() => usePaginacao(itens));
    act(() => result.current.irPara(2));
    act(() => result.current.reset());
    expect(result.current.paginaAtual).toBe(1);
  });

  it('respeita tamanhoInicial', () => {
    const { result } = renderHook(() => usePaginacao(itens, { tamanhoInicial: 20 }));
    expect(result.current.tamanho).toBe(20);
    expect(result.current.totalPaginas).toBe(1);
  });

  it('clampa quando a lista encolhe (página fora do range)', () => {
    const { result, rerender } = renderHook(({ data }) => usePaginacao(data), {
      initialProps: { data: itens },
    });
    act(() => result.current.irPara(3));
    expect(result.current.paginaAtual).toBe(3);
    rerender({ data: [1, 2] }); // agora só 1 página
    expect(result.current.paginaAtual).toBe(1);
    expect(result.current.itensPagina).toEqual([1, 2]);
  });
});
