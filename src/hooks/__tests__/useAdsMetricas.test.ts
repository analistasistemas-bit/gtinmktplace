import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PedidoAdsMetricas, RespostaAdsMetricas } from '../../../supabase/functions/_shared/ads/metricas';

const m = vi.hoisted(() => ({ buscarMetricasAds: vi.fn(), org: 'org-a' as string | null }));
vi.mock('@/hooks/useOrgEfetivaId', () => ({ useOrgEfetivaId: () => m.org }));
vi.mock('@/lib/ads-metricas-dados', () => ({ buscarMetricasAds: m.buscarMetricasAds }));

const { useAdsMetricas } = await import('../useAdsMetricas');

const pedido = (desde: string, extra: Partial<PedidoAdsMetricas> = {}): PedidoAdsMetricas =>
  ({ desde, ate: '2026-10-20', comparar: 'anterior', escopo: 'conta', ...extra });
const resp = (marca: string) => ({ ok: true, estado: 'ok', escopo: 'conta', avisos: [marca] }) as unknown as RespostaAdsMetricas;

function render(inicial: PedidoAdsMetricas | null, habilitado = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  const r = renderHook(({ p, h }) => useAdsMetricas(p, h), { wrapper, initialProps: { p: inicial, h: habilitado } });
  return { ...r, qc };
}

beforeEach(() => { vi.clearAllMocks(); m.org = 'org-a'; });

describe('useAdsMetricas', () => {
  it('pedido null ou desabilitado não chama a edge', () => {
    render(null);
    render(pedido('2026-10-01'), false);
    expect(m.buscarMetricasAds).not.toHaveBeenCalled();
  });

  it('chave inclui org e pedido completo, sem fresco', async () => {
    m.buscarMetricasAds.mockResolvedValue(resp('a'));
    const p = pedido('2026-10-01', { escopo: 'campanha', campanhaId: 7, fresco: true });
    const { result, qc } = render(p);
    await waitFor(() => expect(result.current.data).toBeDefined());
    const chaves = qc.getQueryCache().getAll().map((q) => q.queryKey);
    expect(chaves).toHaveLength(1);
    const k = JSON.stringify(chaves[0]);
    expect(k).toContain('org-a');
    expect(k).toContain('"campanhaId":7');
    expect(k).toContain('"comparar":"anterior"');
    expect(k).not.toContain('fresco');
    expect(m.buscarMetricasAds).toHaveBeenCalledWith(expect.objectContaining({ campanhaId: 7 }));
  });

  it('troca de pedido com resposta pendente não mostra dado antigo', async () => {
    let soltarA!: (v: RespostaAdsMetricas) => void;
    m.buscarMetricasAds.mockImplementation((p: PedidoAdsMetricas) =>
      p.desde === '2026-10-01' ? new Promise((res) => { soltarA = res; }) : Promise.resolve(resp('B')));
    const { result, rerender } = render(pedido('2026-10-01'));
    rerender({ p: pedido('2026-10-05'), h: true });
    await waitFor(() => expect(result.current.data?.avisos).toEqual(['B']));
    await act(async () => { soltarA(resp('A')); });
    expect(result.current.data?.avisos).toEqual(['B']);
  });

  it('troca de organização com resposta pendente: só a org nova fica visível', async () => {
    const pend: Record<string, (v: RespostaAdsMetricas) => void> = {};
    let org = 'org-a';
    m.buscarMetricasAds.mockImplementation(() => new Promise((res) => { pend[org] = res; }));
    const { result, rerender } = render(pedido('2026-10-01'));
    await waitFor(() => expect(pend['org-a']).toBeDefined());
    org = 'org-b'; m.org = 'org-b';
    rerender({ p: pedido('2026-10-01'), h: true });
    await waitFor(() => expect(pend['org-b']).toBeDefined());
    await act(async () => { pend['org-b'](resp('B')); });
    await waitFor(() => expect(result.current.data?.avisos).toEqual(['B']));
    await act(async () => { pend['org-a'](resp('A')); });
    expect(result.current.data?.avisos).toEqual(['B']);
  });

  it('troca de pedido não mantém o dado anterior enquanto carrega', async () => {
    m.buscarMetricasAds.mockImplementation((p: PedidoAdsMetricas) =>
      p.desde === '2026-10-01' ? Promise.resolve(resp('A')) : new Promise(() => {}));
    const { result, rerender } = render(pedido('2026-10-01'));
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ p: pedido('2026-10-05'), h: true });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
  });

  it('erro da edge vira isError com a mensagem', async () => {
    m.buscarMetricasAds.mockRejectedValue(new Error('pedido inválido: futuro'));
    const { result } = render(pedido('2026-10-01'));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('pedido inválido: futuro');
  });

  // C2: "Tentar novamente" refaz a consulta normal (cache da edge vale); só "Atualizar" fura o cache (fresco).
  it('refetch refaz a consulta sem fresco', async () => {
    m.buscarMetricasAds.mockResolvedValueOnce(resp('velho')).mockResolvedValueOnce(resp('novo'));
    const { result } = render(pedido('2026-10-01'));
    await waitFor(() => expect(result.current.data?.avisos).toEqual(['velho']));
    await act(async () => { await result.current.refetch(); });
    expect(m.buscarMetricasAds).toHaveBeenCalledTimes(2);
    expect(m.buscarMetricasAds.mock.calls[1][0].fresco).toBeUndefined();
    await waitFor(() => expect(result.current.data?.avisos).toEqual(['novo']));
  });

  it('atualizar recusado (429) mantém o dado já lido e acusa o erro', async () => {
    m.buscarMetricasAds.mockResolvedValueOnce(resp('velho')).mockRejectedValueOnce(new Error('Atualização recente.'));
    const { result } = render(pedido('2026-10-01'));
    await waitFor(() => expect(result.current.data?.avisos).toEqual(['velho']));
    await act(async () => { await result.current.atualizar(); });
    expect(m.buscarMetricasAds.mock.calls[1][0].fresco).toBe(true);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data?.avisos).toEqual(['velho']);
  });

  it('atualizar envia fresco uma vez e grava na chave atual', async () => {
    m.buscarMetricasAds.mockResolvedValueOnce(resp('velho')).mockResolvedValueOnce(resp('novo'));
    const { result } = render(pedido('2026-10-01'));
    await waitFor(() => expect(result.current.data?.avisos).toEqual(['velho']));
    expect(m.buscarMetricasAds.mock.calls[0][0].fresco).toBeUndefined();
    await act(async () => { await result.current.atualizar(); });
    expect(m.buscarMetricasAds.mock.calls[1][0].fresco).toBe(true);
    await waitFor(() => expect(result.current.data?.avisos).toEqual(['novo']));
    expect(m.buscarMetricasAds).toHaveBeenCalledTimes(2);
  });
});
