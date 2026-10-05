// Painel de Ads: fontes mockadas (vendas, catálogo, RPC do Ads, códigos dos MLBs); a regra
// (montarPainelAds) e a agregação de vendas (vendas-sku) rodam de verdade, com espião para ver o que recebem.
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { somarAcumuladores, metricas, type AcumuladorSku, type LinhaSku } from '@/lib/vendas-sku';
import { janelaBRT } from '@/lib/ads-painel-dados';
import type { FontePainelAds } from '@/lib/ads-painel';

const m = vi.hoisted(() => ({
  buscarPainelAds: vi.fn(), buscarCodigosMlbs: vi.fn(), buscarUltimoOkAds: vi.fn(), useVendasSku: vi.fn(), montarPainelAds: vi.fn(),
  catQ: { data: undefined as unknown, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/lib/ads-painel-dados', async (orig) => ({ ...(await orig<object>()), buscarPainelAds: m.buscarPainelAds }));
vi.mock('@/lib/sku-dossie-dados', () => ({ buscarCodigosMlbs: m.buscarCodigosMlbs, buscarUltimoOkAds: m.buscarUltimoOkAds }));
vi.mock('@/hooks/useVendasSku', () => ({ useVendasSku: m.useVendasSku }));
vi.mock('@/hooks/useCatalogoVendasSku', () => ({ useCatalogoVendasSku: () => m.catQ }));
vi.mock('@/lib/ads-painel', async (orig) => {
  const real = await orig<typeof import('@/lib/ads-painel')>();
  m.montarPainelAds.mockImplementation(real.montarPainelAds);
  return { ...real, montarPainelAds: m.montarPainelAds };
});

const { useAdsPainel } = await import('../useAdsPainel');

const grupo = (id: number, membros: string[]) => ({ ad_group_id: id, tipo: 'FAMILY' as const, status: 'ACTIVE', cost: 10,
  clicks: 0, prints: 0, direct_amount: 0, indirect_amount: 0, total_amount: 0, membros });
const FONTE: FontePainelAds = { sync: null, conta: [], grupos: [grupo(1, ['MLB3', 'MLB1']), grupo(2, ['MLB1', 'MLB2'])] };

function linha(codigo: string, codigoPai: string | null, over: Partial<AcumuladorSku>): LinhaSku {
  const acc = { ...somarAcumuladores([]), ...over };
  return { codigo, codigoPai, nomeFamilia: codigoPai, acc, m: metricas(acc) } as unknown as LinhaSku;
}
const vendasQ = (linhas: LinhaSku[] | null, extra: object = {}) => ({
  dados: linhas && { linhas, historicoDesde: '2026-01-01T03:00:00.000Z' },
  isLoading: false, isFetching: false, isError: false, refetch: vi.fn().mockResolvedValue([]), ...extra,
});

function criarWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

const render = () => renderHook(
  () => useAdsPainel({ tipo: 'preset', dias: 30 }),
  { wrapper: criarWrapper() },
);

function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promise = new Promise<T>(resolve => {
    resolver = resolve;
  });
  return { promise, resolver };
}
const ultimaChamada = () => m.montarPainelAds.mock.calls.at(-1)![0];

beforeEach(() => {
  m.buscarPainelAds.mockReset().mockResolvedValue(FONTE);
  m.buscarCodigosMlbs.mockReset().mockResolvedValue(new Map([['MLB1', ['A1']]]));
  m.buscarUltimoOkAds.mockReset().mockResolvedValue(null);
  m.useVendasSku.mockReset().mockReturnValue(vendasQ([]));
  m.montarPainelAds.mockClear();
  Object.assign(m.catQ, { data: [{ codigo: 'A1', codigoPai: 'A', nomeFamilia: 'Fam A' }], isLoading: false, isFetching: false,
    isError: false, refetch: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => vi.useRealTimers());

describe('useAdsPainel', () => {
  it('(a) vendas no mesmo recorte do Ads: range com os dias da janela e janela BRT explícita', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    const { janela } = r.result.current;
    if (!janela) throw new Error('O período deveria estar pronto');
    expect(m.useVendasSku).toHaveBeenLastCalledWith({ tipo: 'range', ...janela }, janelaBRT(janela.desde, janela.ate), true);
    expect(m.buscarPainelAds).toHaveBeenCalledWith(janela.desde, janela.ate);
    expect(ultimaChamada().janela).toEqual(janela);
  });

  it('(a2) historicoDesde vem das vendas', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(ultimaChamada().historicoDesde).toBe('2026-01-01T03:00:00.000Z');
    expect(r.result.current.historicoDesde).toBe('2026-01-01T03:00:00.000Z');
  });

  it('(a4) sem venda faturável → lucro 0 real; só vendas sem custo → lucro null sem_custo', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(ultimaChamada().lucroConta).toEqual({ lucro: 0, fonteCusto: 'real' });

    m.useVendasSku.mockReturnValue(vendasQ([linha('A1', 'A', { pedidos: 1, unidades: 1, bruto: 10, itensSemCusto: 1 })]));
    const r2 = render();
    await waitFor(() => expect(r2.result.current.painel).not.toBeNull());
    expect(ultimaChamada().lucroConta).toEqual({ lucro: null, fonteCusto: 'sem_custo' });
    expect(ultimaChamada().lucroPorFamilia.get('A')).toEqual({ nome: 'A', lucro: null, brutoComCusto: 0, fonteCusto: 'sem_custo' });
  });

  it('(b) códigos buscados para os MLBs únicos e ordenados de todos os grupos', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(m.buscarCodigosMlbs).toHaveBeenCalledWith(['MLB1', 'MLB2', 'MLB3']);
    expect(ultimaChamada().familiaDoCodigo).toEqual(new Map([['A1', 'A']]));
  });

  it('(c) painel null até vendas, catálogo e códigos chegarem', async () => {
    m.useVendasSku.mockReturnValue(vendasQ(null, { isLoading: true }));
    const r = render();
    await waitFor(() => expect(m.buscarCodigosMlbs).toHaveBeenCalled());
    expect(r.result.current.painel).toBeNull();
    expect(r.result.current.isLoading).toBe(true);

    m.useVendasSku.mockReturnValue(vendasQ([]));
    m.catQ.data = undefined;
    const r2 = render();
    await waitFor(() => expect(m.buscarCodigosMlbs).toHaveBeenCalledTimes(2));
    expect(r2.result.current.painel).toBeNull();

    m.catQ.data = [];
    m.buscarCodigosMlbs.mockReturnValue(new Promise(() => {}));
    const r3 = render();
    await waitFor(() => expect(m.buscarCodigosMlbs).toHaveBeenCalledTimes(3));
    expect(r3.result.current.painel).toBeNull();
    expect(m.montarPainelAds).not.toHaveBeenCalled();
  });

  it('(d) erro em qualquer fonte → isError', async () => {
    m.buscarPainelAds.mockRejectedValue(new Error('rpc'));
    const r = render();
    await waitFor(() => expect(r.result.current.isError).toBe(true));

    m.buscarPainelAds.mockResolvedValue(FONTE);
    m.buscarCodigosMlbs.mockRejectedValue(new Error('cod'));
    const r2 = render();
    await waitFor(() => expect(r2.result.current.isError).toBe(true));

    m.buscarCodigosMlbs.mockResolvedValue(new Map());
    m.useVendasSku.mockReturnValue(vendasQ(null, { isError: true }));
    const r3 = render();
    await waitFor(() => expect(r3.result.current.isError).toBe(true));

    m.useVendasSku.mockReturnValue(vendasQ([]));
    m.catQ.isError = true;
    const r4 = render();
    await waitFor(() => expect(r4.result.current.isError).toBe(true));
  });

  it('(e) período termina no último dia coletado (08:00 BRT, antes da coleta do dia → anteontem)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T08:00:00-03:00') });
    m.buscarUltimoOkAds.mockResolvedValue('2026-10-04T14:17:00Z');
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(r.result.current.janela).toEqual({ desde: '2026-09-04', ate: '2026-10-03' });
    expect(m.buscarPainelAds).toHaveBeenCalledWith('2026-09-04', '2026-10-03');
    expect(m.buscarPainelAds).toHaveBeenCalledTimes(1);
  });

  it('(f) fonte e vendas esperam o sync; erro no sync → isError', async () => {
    m.buscarUltimoOkAds.mockReturnValue(new Promise(() => {}));
    const r = render();
    await waitFor(() => expect(m.buscarUltimoOkAds).toHaveBeenCalled());
    expect(m.buscarPainelAds).not.toHaveBeenCalled();
    expect(m.useVendasSku.mock.calls.every((c) => c[2] === false)).toBe(true);
    expect(r.result.current.isLoading).toBe(true);

    m.buscarUltimoOkAds.mockRejectedValue(new Error('rls'));
    const r2 = render();
    await waitFor(() => expect(r2.result.current.isError).toBe(true));
  });

  it('(g) nome da família do catálogo vai como fallback', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(ultimaChamada().nomeDaFamilia).toEqual(new Map([['A', 'Fam A']]));
  });

  it('mês atual usa a mesma janela em Ads, vendas e montagem', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-10-05T08:00:00-03:00'),
    });
    m.buscarUltimoOkAds.mockResolvedValue('2026-10-04T14:17:00Z');

    const { result } = renderHook(
      () => useAdsPainel({ tipo: 'mes_atual' }),
      { wrapper: criarWrapper() },
    );

    await waitFor(() => expect(result.current.painel).not.toBeNull());

    const janela = { desde: '2026-10-01', ate: '2026-10-03' };

    expect(result.current.janela).toEqual(janela);
    expect(m.buscarPainelAds).toHaveBeenCalledWith(janela.desde, janela.ate);
    expect(m.useVendasSku).toHaveBeenLastCalledWith(
      { tipo: 'range', ...janela },
      janelaBRT(janela.desde, janela.ate),
      true,
    );
    expect(ultimaChamada().janela).toEqual(janela);
  });

  it('mês aguardando não consulta finanças nem herda erro de vendas', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-10-01T12:00:00-03:00'),
    });
    m.buscarUltimoOkAds.mockResolvedValue('2026-10-01T14:17:00Z');
    m.useVendasSku.mockReturnValue(vendasQ(null, { isError: true }));

    const { result } = renderHook(
      () => useAdsPainel({ tipo: 'mes_atual' }),
      { wrapper: criarWrapper() },
    );

    await waitFor(() =>
      expect(result.current.situacaoPeriodo).toBe('aguardando_mes'),
    );

    expect(result.current.janela).toBeNull();
    expect(result.current.painel).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(m.buscarPainelAds).not.toHaveBeenCalled();
    expect(m.buscarCodigosMlbs).not.toHaveBeenCalled();
    expect(m.montarPainelAds).not.toHaveBeenCalled();
    expect(m.useVendasSku.mock.calls.every(call => call[2] === false)).toBe(true);
  });

  it('recalcula o mês no próximo render, sem timer próprio', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-09-30T15:00:00-03:00'),
    });
    m.buscarUltimoOkAds.mockResolvedValue(null);

    const { result, rerender } = renderHook(
      () => useAdsPainel({ tipo: 'mes_atual' }),
      { wrapper: criarWrapper() },
    );

    await waitFor(() => expect(result.current.painel).not.toBeNull());
    expect(result.current.janela).toEqual({
      desde: '2026-09-01',
      ate: '2026-09-29',
    });

    m.buscarPainelAds.mockClear();
    m.montarPainelAds.mockClear();

    vi.setSystemTime(new Date('2026-10-01T12:00:00-03:00'));
    rerender();

    expect(result.current.situacaoPeriodo).toBe('aguardando_mes');
    expect(result.current.janela).toBeNull();
    expect(result.current.painel).toBeNull();
    expect(m.buscarPainelAds).not.toHaveBeenCalled();
    expect(m.montarPainelAds).not.toHaveBeenCalled();
  });

  it('ignora a resposta tardia do preset anterior', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-10-05T12:00:00-03:00'),
    });

    const antiga = pendente<FontePainelAds>();
    m.buscarUltimoOkAds.mockResolvedValue(null);
    m.buscarPainelAds.mockImplementation((desde: string) =>
      desde === '2026-09-05' ? antiga.promise : Promise.resolve(FONTE),
    );

    const { result, rerender } = renderHook(
      ({ dias }: { dias: 7 | 30 }) => useAdsPainel({ tipo: 'preset', dias }),
      { initialProps: { dias: 30 }, wrapper: criarWrapper() },
    );

    await waitFor(() =>
      expect(m.buscarPainelAds).toHaveBeenCalledWith('2026-09-05', '2026-10-04'),
    );

    rerender({ dias: 7 });

    await waitFor(() => expect(result.current.painel).not.toBeNull());
    expect(result.current.janela).toEqual({
      desde: '2026-09-28',
      ate: '2026-10-04',
    });

    await act(async () => {
      antiga.resolver(FONTE);
      await antiga.promise;
    });

    expect(ultimaChamada().janela).toEqual({
      desde: '2026-09-28',
      ate: '2026-10-04',
    });
  });

  it('refetch do dia 2 libera o mês após atualizar o sync', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-10-02T12:00:00-03:00'),
    });
    m.buscarUltimoOkAds.mockResolvedValue('2026-10-01T14:17:00Z');

    const { result } = renderHook(
      () => useAdsPainel({ tipo: 'mes_atual' }),
      { wrapper: criarWrapper() },
    );

    await waitFor(() =>
      expect(result.current.situacaoPeriodo).toBe('aguardando_mes'),
    );

    m.buscarUltimoOkAds.mockResolvedValue('2026-10-02T14:17:00Z');

    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => expect(result.current.painel).not.toBeNull());

    expect(result.current.janela).toEqual({
      desde: '2026-10-01',
      ate: '2026-10-01',
    });
    expect(m.buscarPainelAds).toHaveBeenCalledTimes(1);
    expect(m.buscarPainelAds).toHaveBeenCalledWith('2026-10-01', '2026-10-01');
  });

  it('catálogo carregando: painel null e isLoading depois do sync', async () => {
    Object.assign(m.catQ, { data: undefined, isLoading: true });
    const r = render();
    await waitFor(() => expect(r.result.current.situacaoPeriodo).toBe('pronto'));
    await waitFor(() => expect(m.buscarCodigosMlbs).toHaveBeenCalled());
    expect(r.result.current.painel).toBeNull();
    expect(r.result.current.isLoading).toBe(true);
  });

  it('erro de catálogo: isError depois do sync, sem skeleton permanente', async () => {
    Object.assign(m.catQ, { data: undefined, isError: true });
    const r = render();
    await waitFor(() => expect(r.result.current.situacaoPeriodo).toBe('pronto'));
    expect(r.result.current.isError).toBe(true);
    expect(r.result.current.isLoading).toBe(false);
  });

  it('refetch da mesma janela repete RPC, códigos, vendas e catálogo', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T12:00:00-03:00') });
    m.buscarUltimoOkAds.mockResolvedValue('2026-10-05T14:17:00Z');
    const v = vendasQ([]);
    m.useVendasSku.mockReturnValue(v);
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    m.buscarPainelAds.mockClear();
    m.buscarCodigosMlbs.mockClear();

    await act(async () => {
      await r.result.current.refetch();
    });

    expect(m.buscarPainelAds).toHaveBeenCalledTimes(1);
    expect(m.buscarPainelAds).toHaveBeenCalledWith('2026-09-05', '2026-10-04');
    expect(m.buscarCodigosMlbs).toHaveBeenCalledTimes(1);
    expect(v.refetch).toHaveBeenCalledTimes(1);
    expect(m.catQ.refetch).toHaveBeenCalledTimes(1);
  });

  it('refetch que muda o fim deixa as novas chaves carregarem, sem refetch manual da janela antiga', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T12:00:00-03:00') });
    m.buscarUltimoOkAds.mockResolvedValue('2026-10-04T14:17:00Z');
    const v = vendasQ([]);
    m.useVendasSku.mockReturnValue(v);
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    expect(r.result.current.janela).toEqual({ desde: '2026-09-04', ate: '2026-10-03' });

    m.buscarUltimoOkAds.mockResolvedValue('2026-10-05T14:17:00Z');
    await act(async () => {
      await r.result.current.refetch();
    });

    await waitFor(() => expect(r.result.current.janela).toEqual({ desde: '2026-09-05', ate: '2026-10-04' }));
    await waitFor(() => expect(m.buscarPainelAds).toHaveBeenCalledWith('2026-09-05', '2026-10-04'));
    expect(m.buscarPainelAds.mock.calls.filter((c) => c[1] === '2026-10-03')).toHaveLength(1);
    expect(v.refetch).not.toHaveBeenCalled();
    expect(m.catQ.refetch).not.toHaveBeenCalled();
  });

  it('troca de preset durante o refetch não repete as fontes do preset abandonado', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-05T12:00:00-03:00') });
    const v = vendasQ([]);
    m.useVendasSku.mockReturnValue(v);
    const { result, rerender } = renderHook(
      ({ dias }: { dias: 7 | 30 }) => useAdsPainel({ tipo: 'preset', dias }),
      { initialProps: { dias: 30 }, wrapper: criarWrapper() },
    );
    await waitFor(() => expect(result.current.painel).not.toBeNull());

    const sync = pendente<string | null>();
    m.buscarUltimoOkAds.mockReturnValue(sync.promise);
    let atualizacao!: Promise<void>;
    act(() => {
      atualizacao = result.current.refetch();
    });

    rerender({ dias: 7 });

    await act(async () => {
      sync.resolver(null);
      await atualizacao;
    });

    await waitFor(() => expect(result.current.janela).toEqual({ desde: '2026-09-28', ate: '2026-10-04' }));
    expect(m.buscarPainelAds.mock.calls.filter((c) => c[0] === '2026-09-05')).toHaveLength(1);
    expect(v.refetch).not.toHaveBeenCalled();
    expect(m.catQ.refetch).not.toHaveBeenCalled();
  });
});
