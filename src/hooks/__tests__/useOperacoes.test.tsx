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
const singleMock = vi.fn();
const eqMock = vi.fn(() => ({ order: orderMock, single: singleMock }));
// `useOperacoes`: select → (in)? → order → limit. `limitMock` resolve a lista; `inMock` registra o filtro.
const limitMock = vi.fn();
const inMock = vi.fn();
const listaOrderMock = vi.fn();
const listaQuery = { in: inMock, order: listaOrderMock };
// Builder devolvido por `.in(...)`: distinto do original, para provar que o encadeamento usa o retorno.
const inOrderMock = vi.fn();
const inLimitMock = vi.fn();
// I5: `.neq('status','rascunho')` vem logo depois do select e devolve o builder da lista.
const neqMock = vi.fn(() => listaQuery);
const selectMock = vi.fn(() => ({ eq: eqMock, neq: neqMock, ...listaQuery }));
const fromMock = vi.fn(() => ({ select: selectMock }));
const invokeMock = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { from: fromMock, functions: { invoke: invokeMock } } }));

const { useAcompanharOperacao, useItensOperacao, useOperacoes, usePreviewReajuste, useConfirmarReajuste, ErroOperacao, QK_OPERACOES } = await import('../useOperacoes');
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
  const montar = (filtro?: 'promocao' | 'publicados') => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invalida = vi.spyOn(queryClient, 'invalidateQueries');
    return renderHook((p: { filtro?: 'promocao' | 'publicados' }) => useOperacoes(p.filtro), { initialProps: { filtro }, wrapper });
  };
  const invalidou = (chave: readonly unknown[]) => invalida.mock.calls.filter(([f]) => JSON.stringify((f as { queryKey: unknown }).queryKey) === JSON.stringify(chave)).length;
  const statusInvalidado = () => invalidou(QK.statusPublicados);
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

  it("filtro 'publicados' traz só pausar/reativar/reajustar (aba Operações de Publicados)", async () => {
    const { result } = montar('publicados');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(inMock).toHaveBeenCalledWith('acao', ['pausar', 'reativar', 'reajustar']);
    expect(inLimitMock).toHaveBeenCalledWith(50);
  });

  it('exclui rascunhos de reajuste no servidor, antes do .limit(50)', async () => {
    neqMock.mockClear();
    limitMock.mockResolvedValue({ data: [], error: null });
    const { result } = montar();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(neqMock).toHaveBeenCalledWith('status', 'rascunho');
    expect(neqMock.mock.invocationCallOrder[0]).toBeLessThan(limitMock.mock.invocationCallOrder.at(-1)!);
  });

  it('reajuste concluído invalida status ao vivo e a lista de Publicados', async () => {
    limitMock.mockResolvedValue({ data: [op({ acao: 'reajustar' })], error: null });
    montar();
    await waitFor(() => expect(statusInvalidado()).toBe(1));
    expect(invalidou(QK.publicados)).toBe(1);
  });

  it('pausa concluída não invalida a lista de Publicados (só o status)', async () => {
    limitMock.mockResolvedValue({ data: [op({})], error: null });
    montar();
    await waitFor(() => expect(statusInvalidado()).toBe(1));
    expect(invalidou(QK.publicados)).toBe(0);
  });
});

describe('useAcompanharOperacao (fluxo Publicados)', () => {
  const montar = () => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalida = vi.spyOn(queryClient, 'invalidateQueries');
    renderHook(() => useAcompanharOperacao('OP1'), { wrapper });
    return (chave: readonly unknown[]) => invalida.mock.calls.filter(([f]) => JSON.stringify((f as { queryKey: unknown }).queryKey) === JSON.stringify(chave)).length;
  };
  it('reajuste concluído invalida também a lista de Publicados', async () => {
    singleMock.mockResolvedValue({ data: { status: 'concluida', acao: 'reajustar' }, error: null });
    const invalidou = montar();
    await waitFor(() => expect(invalidou(QK.statusPublicados)).toBe(1));
    expect(invalidou(QK.publicados)).toBe(1);
  });
  it('pausa concluída não invalida a lista de Publicados', async () => {
    singleMock.mockResolvedValue({ data: { status: 'concluida', acao: 'pausar' }, error: null });
    const invalidou = montar();
    await waitFor(() => expect(invalidou(QK.statusPublicados)).toBe(1));
    expect(invalidou(QK.publicados)).toBe(0);
  });
});

describe('reajuste — preview e confirmar (I5)', () => {
  const ajuste = { tipo: 'pct' as const, sentido: '+' as const, valor: 10 };
  // Erro do supabase-js para status ≠ 2xx: `context` é a Response.
  const erroEdge = (corpo: unknown) => ({ context: { json: async () => corpo } });

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    invokeMock.mockReset();
  });

  it('preview envia etapa/acao + pedido e devolve o rascunho', async () => {
    const resp = { operacao_id: 'OP1', itens: [{ ml_item_id: 'MLB1' }], expira_em: '2026-10-04T19:00:00Z' };
    invokeMock.mockResolvedValue({ data: resp, error: null });
    const { result } = renderHook(() => usePreviewReajuste(), { wrapper });
    let r: unknown;
    await act(async () => { r = await result.current.mutateAsync({ ml_item_ids: ['MLB1'], familias: ['F1'], ajuste, precos: { MLB1: 21.99 } }); });
    expect(invokeMock).toHaveBeenCalledWith('operacoes-massa', {
      body: { etapa: 'preview', acao: 'reajustar', ml_item_ids: ['MLB1'], familias: ['F1'], ajuste, precos: { MLB1: 21.99 } },
    });
    expect(r).toEqual(resp);
  });

  it('preview sem alteração: operacao_id null', async () => {
    invokeMock.mockResolvedValue({ data: { operacao_id: null, itens: [] }, error: null });
    const { result } = renderHook(() => usePreviewReajuste(), { wrapper });
    let r: { operacao_id: string | null } | undefined;
    await act(async () => { r = await result.current.mutateAsync({ ml_item_ids: ['MLB1'], ajuste }); });
    expect(r?.operacao_id).toBeNull();
  });

  it('preview com erro vira ErroOperacao com itens', async () => {
    invokeMock.mockResolvedValue({ data: null, error: erroEdge({ erro: 'Fora da org.', itens: [{ ml_item_id: 'MLB9', motivo: 'Fora da org' }] }) });
    const { result } = renderHook(() => usePreviewReajuste(), { wrapper });
    let e: unknown;
    await act(async () => { e = await result.current.mutateAsync({ ml_item_ids: ['MLB9'], ajuste }).catch((x) => x); });
    expect(e).toBeInstanceOf(ErroOperacao);
    expect((e as InstanceType<typeof ErroOperacao>).message).toBe('Fora da org.');
    expect((e as InstanceType<typeof ErroOperacao>).itens).toEqual([{ ml_item_id: 'MLB9', motivo: 'Fora da org' }]);
  });

  it('confirmar envia as confirmações e invalida a lista de operações', async () => {
    invokeMock.mockResolvedValue({ data: { operacao_id: 'OP1' }, error: null });
    const invalida = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useConfirmarReajuste(), { wrapper });
    const confirmacoes = [{ ml_item_id: 'MLB1', incluir: true, risco: true, sem_dado: false }];
    await act(async () => { await result.current.mutateAsync({ operacao_id: 'OP1', confirmacoes }); });
    expect(invokeMock).toHaveBeenCalledWith('operacoes-massa', { body: { etapa: 'confirmar', operacao_id: 'OP1', confirmacoes } });
    expect(invalida).toHaveBeenCalledWith({ queryKey: QK_OPERACOES });
  });

  it.each([
    ['400 risco', { erro: 'Confirme o risco deste anúncio', itens: [{ ml_item_id: 'MLB1', motivo: 'Confirme o risco deste anúncio' }] }],
    ['409 ocupado', { erro: 'Algum destes anúncios já está numa operação em andamento.', itens: [{ ml_item_id: 'MLB2', motivo: 'x' }] }],
    ['400 expirado (sem itens)', { erro: 'O preview expirou — gere de novo' }],
  ])('confirmar %s → ErroOperacao com erro/itens do corpo', async (_n, corpo) => {
    invokeMock.mockResolvedValue({ data: null, error: erroEdge(corpo) });
    const { result } = renderHook(() => useConfirmarReajuste(), { wrapper });
    let e: unknown;
    await act(async () => { e = await result.current.mutateAsync({ operacao_id: 'OP1', confirmacoes: [] }).catch((x) => x); });
    expect(e).toBeInstanceOf(ErroOperacao);
    expect((e as InstanceType<typeof ErroOperacao>).message).toBe(corpo.erro);
    expect((e as InstanceType<typeof ErroOperacao>).itens).toEqual((corpo as { itens?: unknown }).itens);
  });
});
