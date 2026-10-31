// Isolamento por org nas fontes financeiras REAIS do /ads (useVendas, useCustos, useAliquotas, useDevolucoes,
// useCatalogoVendasSku via useVendasSku): só os fetchers são mockados. Troca A → B com as respostas de A
// pendentes: quando A responde tarde, cai na chave de A e nunca entra no cálculo de B.
import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { montarMapasCusto } from '@/lib/custos';
import { janelaBRT } from '@/lib/ads-painel-dados';
import type { Venda } from '@/lib/faturamento';

const m = vi.hoisted(() => ({
  org: 'org-a' as string | null,
  pend: new Map<string, (() => void)[]>(),
  buscarVendas: vi.fn(), buscarCustos: vi.fn(), fetchAliquotas: vi.fn(), buscarDevolucoes: vi.fn(),
  fetchCatalogoVendasSku: vi.fn(),
}));
vi.mock('@/hooks/useOrgEfetivaId', () => ({ useOrgEfetivaId: () => m.org }));
vi.mock('@/lib/faturamento', async (orig) => ({ ...(await orig<object>()), buscarVendas: m.buscarVendas }));
vi.mock('@/lib/custos', async (orig) => ({ ...(await orig<object>()), buscarCustos: m.buscarCustos }));
vi.mock('@/lib/queries', async (orig) => ({ ...(await orig<object>()), fetchAliquotas: m.fetchAliquotas }));
vi.mock('@/lib/devolucoes', async (orig) => ({ ...(await orig<object>()), buscarDevolucoes: m.buscarDevolucoes }));
vi.mock('@/lib/vendas-sku-catalogo', async (orig) => ({ ...(await orig<object>()), fetchCatalogoVendasSku: m.fetchCatalogoVendasSku }));
const vazio = { data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() };
vi.mock('@/hooks/useFotosProduto', () => ({ useFotosProduto: () => vazio }));
vi.mock('@/hooks/useCoresProduto', () => ({ useCoresProduto: () => vazio }));
vi.mock('@/hooks/useAnuncioCanonico', () => ({ useAnuncioCanonico: () => vazio }));

const { useVendasSku } = await import('../useVendasSku');

const venda = (total: number) => ({
  id: `v${total}`, order_id: total, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-10-02T15:00:00.000Z', date_created: '2026-10-02T15:00:00.000Z', uf: 'SP', cidade: null,
  total_amount: total, paid_amount: total, liquido: total, cupom_vendedor: 0, sale_fee_total: 0, frete_vendedor: 0,
  estorno: 0, atualizado_em: '2026-10-02T15:00:00.000Z', currency: 'BRL', shipping_id: null, shipping_status: null,
  shipping_substatus: null, shipping_logistic: null, itens: [],
}) as unknown as Venda;
const DADOS = {
  'org-a': { vendas: [venda(999)] },
  'org-b': { vendas: [venda(100)] },
} as const;
const ALIQ = { nacional: 8, importado: 16, confirmada: true, ufEmpresa: null, internaPct: null };

/** Responde na hora para B; para A fica pendente até `soltarA()`. */
function porOrg<T>(valor: (org: 'org-a' | 'org-b') => T) {
  return () => {
    const org = m.org as 'org-a' | 'org-b';
    if (org === 'org-b') return Promise.resolve(valor(org));
    return new Promise<T>((res) => {
      const fila = m.pend.get(org) ?? [];
      fila.push(() => res(valor(org)));
      m.pend.set(org, fila);
    });
  };
}
const soltarA = () => { for (const f of m.pend.get('org-a') ?? []) f(); m.pend.delete('org-a'); };

beforeEach(() => {
  m.org = 'org-a';
  m.pend.clear();
  m.buscarVendas.mockReset().mockImplementation(porOrg((o) => DADOS[o].vendas));
  m.buscarCustos.mockReset().mockImplementation(porOrg(() => montarMapasCusto([])));
  m.fetchAliquotas.mockReset().mockImplementation(porOrg(() => ALIQ));
  m.buscarDevolucoes.mockReset().mockImplementation(porOrg(() => []));
  m.fetchCatalogoVendasSku.mockReset().mockImplementation(porOrg(() => []));
});

describe('fontes financeiras isoladas por org', () => {
  it('troca A → B com respostas de A pendentes: B nunca usa dado de A', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    const janela = janelaBRT('2026-10-01', '2026-10-04');
    const periodo = { tipo: 'range' as const, desde: '2026-10-01', ate: '2026-10-04' };
    const r = renderHook(() => useVendasSku(periodo, janela, true, { canal: 'mercado_livre' }), { wrapper });
    await waitFor(() => expect(m.pend.get('org-a')?.length).toBe(5));

    m.org = 'org-b';
    r.rerender();
    await waitFor(() => expect(r.result.current.dados).not.toBeNull());
    expect(r.result.current.faturamentoConta?.atual).toBe(100);

    await act(async () => { soltarA(); await new Promise((res) => setTimeout(res, 0)); });

    expect(r.result.current.faturamentoConta?.atual).toBe(100);
    const chaves = qc.getQueryCache().getAll().map((q) => q.queryKey);
    expect(chaves.length).toBeGreaterThanOrEqual(10);
    for (const k of chaves) expect(k.at(-1)).toMatch(/^org-[ab]$/);
    // A resposta tardia de A ficou na chave de A.
    const vendasA = qc.getQueryCache().getAll().find((q) => q.queryKey[0] === 'vendas' && q.queryKey.at(-1) === 'org-a');
    expect((vendasA?.state.data as Venda[] | undefined)?.[0]?.total_amount).toBe(999);
  });

  it('sem org: nenhuma fonte financeira consulta', async () => {
    m.org = null;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
    renderHook(() => useVendasSku({ tipo: 'preset', dias: 30 }), { wrapper });
    await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
    for (const f of [m.buscarVendas, m.buscarCustos, m.fetchAliquotas, m.buscarDevolucoes, m.fetchCatalogoVendasSku]) {
      expect(f).not.toHaveBeenCalled();
    }
  });
});
