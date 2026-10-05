// Painel de Ads: fontes mockadas (vendas, catálogo, RPC do Ads, códigos dos MLBs); a regra
// (montarPainelAds) e a agregação de vendas (vendas-sku) rodam de verdade, com espião para ver o que recebem.
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { somarAcumuladores, metricas, type AcumuladorSku, type LinhaSku } from '@/lib/vendas-sku';
import { janelaBRT } from '@/lib/ads-painel-dados';
import type { FontePainelAds } from '@/lib/ads-painel';

const m = vi.hoisted(() => ({
  buscarPainelAds: vi.fn(), buscarCodigosMlbs: vi.fn(), useVendasSku: vi.fn(), montarPainelAds: vi.fn(),
  catQ: { data: undefined as unknown, isLoading: false, isError: false },
}));
vi.mock('@/lib/ads-painel-dados', async (orig) => ({ ...(await orig<object>()), buscarPainelAds: m.buscarPainelAds }));
vi.mock('@/lib/sku-dossie-dados', () => ({ buscarCodigosMlbs: m.buscarCodigosMlbs }));
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
  isLoading: false, isError: false, refetch: vi.fn(), ...extra,
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}
const render = () => renderHook(() => useAdsPainel(30), { wrapper });
const ultimaChamada = () => m.montarPainelAds.mock.calls.at(-1)![0];

beforeEach(() => {
  m.buscarPainelAds.mockReset().mockResolvedValue(FONTE);
  m.buscarCodigosMlbs.mockReset().mockResolvedValue(new Map([['MLB1', ['A1']]]));
  m.useVendasSku.mockReset().mockReturnValue(vendasQ([]));
  m.montarPainelAds.mockClear();
  Object.assign(m.catQ, { data: [{ codigo: 'A1', codigoPai: 'A' }], isLoading: false, isError: false });
});

describe('useAdsPainel', () => {
  it('(a) vendas no mesmo recorte do Ads: range com os dias da janela e janela BRT explícita', async () => {
    const r = render();
    await waitFor(() => expect(r.result.current.painel).not.toBeNull());
    const { janela } = r.result.current;
    expect(m.useVendasSku).toHaveBeenCalledWith({ tipo: 'range', ...janela }, janelaBRT(janela.desde, janela.ate));
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
    expect(render().result.current.isError).toBe(true);

    m.useVendasSku.mockReturnValue(vendasQ([]));
    m.catQ.isError = true;
    expect(render().result.current.isError).toBe(true);
  });
});
