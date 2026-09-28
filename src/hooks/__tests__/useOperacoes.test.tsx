import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `useItensOperacao(id, executando)`: refetchInterval só gira enquanto `executando`. Fix round 2
// (achado 2 da revisão da Task 8) — na borda executando:true→false o intervalo desliga sem buscar
// uma última vez; quem está com o sheet de detalhe aberto ficava vendo status velho (a lista, que
// traz os status no mesmo select, já tinha atualizado). Este teste prova o refetch nessa borda sem
// depender de temporizador (a correção dispara num `useEffect`, não no `refetchInterval`).
const orderMock = vi.fn();
const eqMock = vi.fn(() => ({ order: orderMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }));

const { useItensOperacao } = await import('../useOperacoes');

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useItensOperacao', () => {
  beforeEach(() => {
    orderMock.mockReset().mockResolvedValue({ data: [], error: null });
    fromMock.mockClear();
  });

  it('refaz a busca uma vez quando a operação sai de executando (sem esperar o próximo tick)', async () => {
    const { rerender } = renderHook(
      ({ executando }) => useItensOperacao('OP1', executando),
      { initialProps: { executando: true }, wrapper },
    );
    await act(async () => { await Promise.resolve(); });
    expect(fromMock).toHaveBeenCalledTimes(1);

    rerender({ executando: false });
    await act(async () => { await Promise.resolve(); });
    expect(fromMock).toHaveBeenCalledTimes(2);

    // Depois de virar `false`, não refaz de novo sem motivo (só na transição true → false).
    rerender({ executando: false });
    await act(async () => { await Promise.resolve(); });
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it('não refaz quando já nasce com executando=false (não há transição)', async () => {
    renderHook(({ executando }) => useItensOperacao('OP1', executando), {
      initialProps: { executando: false }, wrapper,
    });
    await act(async () => { await Promise.resolve(); });
    expect(fromMock).toHaveBeenCalledTimes(1);
  });
});
