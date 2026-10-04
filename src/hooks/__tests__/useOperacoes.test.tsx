import { act, renderHook, waitFor } from '@testing-library/react';
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
// `useOperacoes`: select → (in)? → order → limit. `limitMock` resolve a lista; `inMock` registra o filtro.
const limitMock = vi.fn();
const inMock = vi.fn();
const listaOrderMock = vi.fn();
const listaQuery = { in: inMock, order: listaOrderMock };
// Builder devolvido por `.in(...)`: distinto do original, para provar que o encadeamento usa o retorno.
const inOrderMock = vi.fn();
const inLimitMock = vi.fn();
const selectMock = vi.fn(() => ({ eq: eqMock, ...listaQuery }));
const fromMock = vi.fn(() => ({ select: selectMock }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock } }));

const { useItensOperacao, useOperacoes } = await import('../useOperacoes');
const { QK } = await import('@/lib/queries');

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  queryClient ??= new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useItensOperacao', () => {
  beforeEach(() => {
    queryClient = undefined as unknown as QueryClient;
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

describe('useOperacoes — status ao vivo do Publicados (emenda 2026-10-04)', () => {
  const op = (over: Record<string, unknown>) => ({ id: 'OP1', acao: 'pausar', status: 'concluida', concluido_em: new Date().toISOString(), itens: [], ...over });
  let invalida: { mock: { calls: unknown[][] } };
  const montar = (filtro?: 'promocao') => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalida = vi.spyOn(queryClient, 'invalidateQueries');
    return renderHook((p: { filtro?: 'promocao' }) => useOperacoes(p.filtro), { initialProps: { filtro }, wrapper });
  };
  const statusInvalidado = () => invalida.mock.calls.filter(([f]) => JSON.stringify((f as { queryKey: unknown }).queryKey) === JSON.stringify(QK.statusPublicados)).length;
  const tick = () => act(async () => { await new Promise((r) => setTimeout(r)); });

  beforeEach(() => {
    limitMock.mockReset();
    inLimitMock.mockReset().mockResolvedValue({ data: [], error: null });
    inOrderMock.mockReset().mockImplementation(() => ({ limit: inLimitMock }));
    inMock.mockReset().mockImplementation(() => ({ order: inOrderMock }));
    listaOrderMock.mockReset().mockImplementation(() => ({ limit: limitMock }));
  });

  it('1ª leitura já concluída invalida uma vez; refetch com o mesmo dado não invalida de novo', async () => {
    limitMock.mockResolvedValue({ data: [op({})], error: null });
    const { result } = montar();
    await waitFor(() => expect(statusInvalidado()).toBe(1));
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    await tick();
    expect(statusInvalidado()).toBe(1);
  });

  it('executando → concluída invalida', async () => {
    limitMock.mockResolvedValue({ data: [op({ status: 'executando', concluido_em: null })], error: null });
    const { result } = montar();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await tick();
    expect(statusInvalidado()).toBe(0);
    limitMock.mockResolvedValue({ data: [op({})], error: null });
    await act(async () => { await result.current.refetch(); });
    await waitFor(() => expect(statusInvalidado()).toBe(1));
  });

  it('conclusão de 1 h atrás não invalida', async () => {
    limitMock.mockResolvedValue({ data: [op({ concluido_em: new Date(Date.now() - 3_600_000).toISOString() })], error: null });
    const { result } = montar();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await tick();
    expect(statusInvalidado()).toBe(0);
  });

  it('operação de promoção concluída não invalida', async () => {
    limitMock.mockResolvedValue({ data: [op({ acao: 'aderir' })], error: null });
    const { result } = montar();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await tick();
    expect(statusInvalidado()).toBe(0);
  });

  it("filtro 'promocao' aplica .in('acao', …) antes do .limit(50); sem filtro não", async () => {
    limitMock.mockResolvedValue({ data: [], error: null });
    const { result: r1 } = montar('promocao');
    await waitFor(() => expect(r1.current.isSuccess).toBe(true));
    expect(inMock).toHaveBeenCalledWith('acao', ['aderir', 'sair']);
    expect(inLimitMock).toHaveBeenCalledWith(50); // limit no builder retornado por .in
    expect(listaOrderMock).not.toHaveBeenCalled(); // o builder original não é usado depois do .in
    inMock.mockClear();
    const { result: r2 } = montar();
    await waitFor(() => expect(r2.current.isSuccess).toBe(true));
    expect(inMock).not.toHaveBeenCalled();
    expect(limitMock).toHaveBeenCalledWith(50);
  });
});
