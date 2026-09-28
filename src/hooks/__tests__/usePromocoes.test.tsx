import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fix round 1 (achado 1 da revisão da Task 9): `encerrarAusentes` (_shared/promocoes/deps.ts)
// marca a CAMPANHA `finished` mas não reescreve nem apaga a linha do item — ela fica
// `started`/`pending` pra sempre em `ml_promocao_itens`. Sem checar `ml_promocoes.status`, o aviso
// dispararia pra sempre numa campanha já encerrada. Este teste prova que a campanha finished é
// ignorada mesmo com o item ainda "started".
vi.mock('@/hooks/useModulosHabilitados', () => ({
  useModulosHabilitados: () => ({ data: ['promocoes'] }),
}));

const itensQueryMock = vi.fn();
const promosQueryMock = vi.fn();
const fromMock = vi.fn((tabela: string) => {
  if (tabela === 'ml_promocao_itens') {
    return { select: () => ({ in: () => ({ in: itensQueryMock }) }) };
  }
  if (tabela === 'ml_promocoes') {
    return { select: () => ({ in: promosQueryMock }) };
  }
  throw new Error(`tabela inesperada no mock: ${tabela}`);
});
vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }));

const { useParticipacoesPorItem } = await import('../usePromocoes');

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useParticipacoesPorItem', () => {
  beforeEach(() => {
    fromMock.mockClear();
    itensQueryMock.mockReset();
    promosQueryMock.mockReset();
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
});
