import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fix round 1 (achado 1 da revisão da Task 9): `encerrarAusentes` (_shared/promocoes/deps.ts)
// marca a CAMPANHA `finished` mas não reescreve nem apaga a linha do item — ela fica
// `started`/`pending` pra sempre em `ml_promocao_itens`. Sem checar `ml_promocoes.status`, o aviso
// dispararia pra sempre numa campanha já encerrada. Este teste prova que a campanha finished é
// ignorada mesmo com o item ainda "started".
const useModulosHabilitadosMock = vi.fn<() => { data: string[] | undefined; isError: boolean }>(
  () => ({ data: ['promocoes'], isError: false }),
);
vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => useModulosHabilitadosMock(),
}));

const itensQueryMock = vi.fn();
const orMock = vi.fn();
const promosQueryMock = vi.fn();
const fromMock = vi.fn((tabela: string) => {
  if (tabela === 'ml_promocao_itens') {
    return { select: () => ({ or: orMock.mockImplementation(() => ({ in: itensQueryMock })) }) };
  }
  if (tabela === 'ml_promocoes') {
    return { select: () => ({ in: promosQueryMock }) };
  }
  throw new Error(`tabela inesperada no mock: ${tabela}`);
});
vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }));

const { useParticipacoesPorItem, useItensPromocao } = await import('../usePromocoes');

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useParticipacoesPorItem', () => {
  beforeEach(() => {
    fromMock.mockClear();
    itensQueryMock.mockReset();
    promosQueryMock.mockReset();
    useModulosHabilitadosMock.mockReturnValue({ data: ['promocoes'], isError: false });
  });

  it('ignora item ainda "started" cuja campanha já está "finished" (sync não reescreve o item)', async () => {
    itensQueryMock.mockResolvedValue({
      data: [{ ml_item_id: 'MLB1', promocao_id: 'P1', status: 'started' }],
      error: null,
    });
    promosQueryMock.mockResolvedValue({
      data: [{ promocao_id: 'P1', nome: 'Campanha Encerrada', tipo: 'DEAL', status: 'finished' }],
      error: null,
    });

    const { result } = renderHook(() => useParticipacoesPorItem(['MLB1']), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(new Map());
  });

  it('mantém item cuja campanha ainda está "started"', async () => {
    itensQueryMock.mockResolvedValue({
      data: [{ ml_item_id: 'MLB1', promocao_id: 'P1', status: 'started' }],
      error: null,
    });
    promosQueryMock.mockResolvedValue({
      data: [{ promocao_id: 'P1', nome: 'Campanha Ativa', tipo: 'DEAL', status: 'started' }],
      error: null,
    });

    const { result } = renderHook(() => useParticipacoesPorItem(['MLB1']), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(new Map([['MLB1', 'Campanha Ativa']]));
  });

  // ADR-0174, emenda 2026-10-05: o par normal/catálogo é a linha do catálogo; a família conhece o normal.
  it('acha a participação do catálogo pelo MLB do normal', async () => {
    itensQueryMock.mockResolvedValue({
      data: [{ ml_item_id: 'MLB7', anuncio_normal_id: 'MLB5', promocao_id: 'P1', status: 'started' }],
      error: null,
    });
    promosQueryMock.mockResolvedValue({
      data: [{ promocao_id: 'P1', nome: 'Campanha Ativa', tipo: 'DEAL', status: 'started' }],
      error: null,
    });

    const { result } = renderHook(() => useParticipacoesPorItem(['MLB5']), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(orMock).toHaveBeenCalledWith('ml_item_id.in.(MLB5),anuncio_normal_id.in.(MLB5)');
    expect(result.current.data?.get('MLB5')).toBe('Campanha Ativa');
  });

  // Grok #4: o .or repete a lista nos dois filtros; centenas de MLBs estouram a URL → fatia em 80.
  it('fatia os MLBs em blocos de 80', async () => {
    orMock.mockClear();
    itensQueryMock.mockResolvedValue({ data: [], error: null });
    const ids = Array.from({ length: 170 }, (_, i) => `MLB${i}`);
    const { result } = renderHook(() => useParticipacoesPorItem(ids), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(orMock).toHaveBeenCalledTimes(3);
  });

  // Fix round 2 (achado 3 da revisão final): RPC de módulos em erro desliga esta query
  // (habilitado=false → enabled=false), que sozinha nunca chega a isError.
  it('conta como falha quando a RPC de módulos falha', async () => {
    useModulosHabilitadosMock.mockReturnValue({ data: undefined, isError: true });

    const { result } = renderHook(() => useParticipacoesPorItem(['MLB1']), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(itensQueryMock).not.toHaveBeenCalled();
  });
});

describe('useItensPromocao', () => {
  it("id vazio não consulta o supabase", () => {
    fromMock.mockClear();
    renderHook(() => useItensPromocao(''), { wrapper });
    expect(fromMock).not.toHaveBeenCalled();
  });
});
