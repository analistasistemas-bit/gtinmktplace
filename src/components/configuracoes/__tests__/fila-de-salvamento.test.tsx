import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFilaDeSalvamento } from '../settings-row';

type Aliquotas = { nacional: number; importado: number; ufEmpresa: string | null; internaPct: number | null };

const CARREGADO: Aliquotas = { nacional: 8, importado: 16, ufEmpresa: 'PE', internaPct: 4 };

/** Promessa com resolve/reject expostos, para controlar a ordem de conclusão no teste. */
function adiada<T = void>() {
  let resolver!: (v: T) => void;
  let rejeitar!: (e: unknown) => void;
  const promessa = new Promise<T>((res, rej) => { resolver = res; rejeitar = rej; });
  return { promessa, resolver, rejeitar };
}

describe('useFilaDeSalvamento', () => {
  it('só aceita edição depois de semear o snapshot com o dado carregado', () => {
    const { result, rerender } = renderHook(
      ({ dado }: { dado?: Aliquotas }) => useFilaDeSalvamento<Aliquotas>(dado),
      { initialProps: { dado: undefined as Aliquotas | undefined } },
    );

    expect(result.current.pronto).toBe(false);

    const executar = vi.fn().mockResolvedValue(undefined);
    act(() => result.current.salvar('nacional', { nacional: 9 }, executar));
    expect(executar).not.toHaveBeenCalled();

    rerender({ dado: CARREGADO });
    expect(result.current.pronto).toBe(true);
  });

  it('salvar um campo preserva os outros três do snapshot', async () => {
    const { result } = renderHook(() => useFilaDeSalvamento<Aliquotas>(CARREGADO));
    await waitFor(() => expect(result.current.pronto).toBe(true));

    const executar = vi.fn().mockResolvedValue(undefined);
    act(() => result.current.salvar('nacional', { nacional: 9 }, executar));

    await waitFor(() => expect(executar).toHaveBeenCalledTimes(1));
    // O payload é o snapshot inteiro: ufEmpresa e internaPct, que o operador não tocou,
    // continuam lá. Um snapshot parcial os apagaria (upsertAliquotas grava as 4 chaves).
    expect(executar).toHaveBeenCalledWith({ nacional: 9, importado: 16, ufEmpresa: 'PE', internaPct: 4 });
  });

  it('acende o estado só na linha salva, não nas outras', async () => {
    const { result } = renderHook(() => useFilaDeSalvamento<Aliquotas>(CARREGADO));
    await waitFor(() => expect(result.current.pronto).toBe(true));

    act(() => result.current.salvar('nacional', { nacional: 9 }, () => Promise.resolve()));
    await waitFor(() => expect(result.current.estados.nacional).toBe('salvo'));
    expect(result.current.estados.importado).toBeUndefined();
  });

  it('single-flight: a segunda gravação só começa quando a primeira termina, e leva o valor mais novo', async () => {
    const { result } = renderHook(() => useFilaDeSalvamento<Aliquotas>(CARREGADO));
    await waitFor(() => expect(result.current.pronto).toBe(true));

    const primeira = adiada();
    const chamadas: Aliquotas[] = [];
    const executar = vi.fn((s: Aliquotas) => {
      chamadas.push(s);
      return chamadas.length === 1 ? primeira.promessa : Promise.resolve();
    });

    act(() => result.current.salvar('nacional', { nacional: 9 }, executar));
    act(() => result.current.salvar('importado', { importado: 20 }, executar));

    // A segunda não parte enquanto a primeira não termina: uma requisição em voo por fila.
    // (a fila é encadeada em microtasks, então a primeira chamada não é síncrona)
    await waitFor(() => expect(executar).toHaveBeenCalledTimes(1));
    expect(executar).toHaveBeenCalledTimes(1);

    await act(async () => { primeira.resolver(); await primeira.promessa; });
    await waitFor(() => expect(executar).toHaveBeenCalledTimes(2));

    // A segunda leva o snapshot já atualizado pela primeira — não um valor velho de cache.
    expect(chamadas[1]).toEqual({ nacional: 9, importado: 20, ufEmpresa: 'PE', internaPct: 4 });
  });

  it('uma falha não descarta o que está enfileirado atrás dela', async () => {
    const { result } = renderHook(() => useFilaDeSalvamento<Aliquotas>(CARREGADO));
    await waitFor(() => expect(result.current.pronto).toBe(true));

    const primeira = adiada();
    let chamadas = 0;
    const executar = vi.fn(() => {
      chamadas += 1;
      return chamadas === 1 ? primeira.promessa : Promise.resolve();
    });

    act(() => result.current.salvar('nacional', { nacional: 9 }, executar));
    act(() => result.current.salvar('importado', { importado: 20 }, executar));

    await act(async () => {
      primeira.rejeitar(new Error('RLS recusou'));
      await primeira.promessa.catch(() => undefined);
    });

    await waitFor(() => expect(result.current.estados.nacional).toBe('erro'));
    expect(result.current.erros.nacional).toContain('RLS recusou');

    // A segunda rodou mesmo assim, e o erro da primeira não contaminou a linha dela.
    await waitFor(() => expect(result.current.estados.importado).toBe('salvo'));
    expect(executar).toHaveBeenCalledTimes(2);
  });

  it('dois blurs no mesmo campo: vence o mais recente, o antigo não sobrescreve', async () => {
    const { result } = renderHook(() => useFilaDeSalvamento<Aliquotas>(CARREGADO));
    await waitFor(() => expect(result.current.pronto).toBe(true));

    const primeira = adiada();
    let chamadas = 0;
    const executar = vi.fn(() => {
      chamadas += 1;
      return chamadas === 1 ? primeira.promessa : Promise.resolve();
    });

    act(() => result.current.salvar('nacional', { nacional: 9 }, executar));
    act(() => result.current.salvar('nacional', { nacional: 10 }, executar));

    // A primeira falha; se o resultado dela vencesse, a linha ficaria em "erro".
    await act(async () => {
      primeira.rejeitar(new Error('antiga'));
      await primeira.promessa.catch(() => undefined);
    });

    await waitFor(() => expect(result.current.estados.nacional).toBe('salvo'));
    expect(result.current.erros.nacional).toBeUndefined();
  });
});
