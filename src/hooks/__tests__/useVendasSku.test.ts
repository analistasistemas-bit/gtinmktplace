// Sem custos carregados toda linha sairia "sem custo" (faixa vermelha) por um instante: o hook
// segura `dados` até a query de custos assentar.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { montarMapasCusto } from '@/lib/custos';
import { resolverJanela, janelaAnterior } from '@/lib/metricas';
import { janelaEstendida } from '@/lib/vendas-sku';

const { custosQ, catQ, devQ, useVendas, vendasQ } = vi.hoisted(() => ({
  useVendas: vi.fn(),
  vendasQ: { data: [] as unknown },
  custosQ: { data: undefined as unknown, isLoading: true, isFetching: true, isError: false },
  catQ: { data: [] as unknown, isLoading: false, isFetching: false, isError: false, refetch: () => Promise.resolve() },
  devQ: { data: [] as unknown, isLoading: false, isFetching: false, isError: false, refetch: () => Promise.resolve() },
}));
const q = (data: unknown) => ({ data, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() });

vi.mock('@/hooks/useVendas', () => ({ useVendas: (...a: unknown[]) => { useVendas(...a); return q(vendasQ.data); } }));
vi.mock('@/hooks/useCustos', () => ({ useCustos: () => custosQ }));
vi.mock('@/hooks/useFotosProduto', () => ({ useFotosProduto: () => q(undefined) }));
vi.mock('@/hooks/useCoresProduto', () => ({ useCoresProduto: () => q(undefined) }));
vi.mock('@/hooks/useAnuncioCanonico', () => ({ useAnuncioCanonico: () => q(undefined) }));
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => q({ nacional: 8, importado: 16 }) }));
vi.mock('@/hooks/useDevolucoes', () => ({ useDevolucoes: () => devQ }));
vi.mock('@/hooks/useCatalogoVendasSku', () => ({ useCatalogoVendasSku: () => catQ }));

const { useVendasSku } = await import('../useVendasSku');
const periodo = { tipo: 'preset', dias: 30 } as const;

describe('useVendasSku — espera os custos', () => {
  it('custos carregando: dados null e isLoading true', () => {
    const r = renderHook(() => useVendasSku(periodo)).result.current;
    expect(r.dados).toBeNull();
    expect(r.isLoading).toBe(true);
  });

  it('custos com erro: calcula sem custos (tela mostra "sem custo")', () => {
    Object.assign(custosQ, { data: undefined, isLoading: false, isFetching: false, isError: true });
    const r = renderHook(() => useVendasSku(periodo)).result.current;
    expect(r.dados).not.toBeNull();
    expect(r.isLoading).toBe(false);
    Object.assign(custosQ, { isError: false });
  });

  it('custos prontos: dados calculados', () => {
    Object.assign(custosQ, { data: montarMapasCusto([]), isLoading: false, isFetching: false });
    const r = renderHook(() => useVendasSku(periodo)).result.current;
    expect(r.dados).not.toBeNull();
    expect(r.isLoading).toBe(false);
  });
});

describe('useVendasSku — erro', () => {
  it('catálogo com erro: isError true (a tela não fica em skeleton para sempre)', () => {
    Object.assign(custosQ, { data: montarMapasCusto([]), isLoading: false, isFetching: false, isError: false });
    Object.assign(catQ, { data: undefined, isError: true });
    const r = renderHook(() => useVendasSku(periodo)).result.current;
    expect(r.isError).toBe(true);
    expect(r.dados).toBeNull();
    Object.assign(catQ, { data: [], isError: false });
  });
});

describe('useVendasSku — espera as devoluções', () => {
  it('devoluções carregando: dados null e isLoading true (taxa não sai 0 no load)', () => {
    Object.assign(custosQ, { data: montarMapasCusto([]), isLoading: false, isFetching: false, isError: false });
    Object.assign(devQ, { data: undefined, isLoading: true });
    const r = renderHook(() => useVendasSku(periodo)).result.current;
    expect(r.dados).toBeNull();
    expect(r.isLoading).toBe(true);
    Object.assign(devQ, { data: [], isLoading: false });
  });

  it('devoluções com erro: isError true (taxa não é calculada com lista vazia em silêncio)', () => {
    Object.assign(devQ, { data: undefined, isError: true });
    const r = renderHook(() => useVendasSku(periodo)).result.current;
    expect(r.isError).toBe(true);
    expect(r.dados).toBeNull();
    Object.assign(devQ, { data: [], isError: false });
  });
});

describe('useVendasSku — janelaFixa', () => {
  const range = { tipo: 'range', desde: '2026-09-04', ate: '2026-10-03' } as const;

  it('com janelaFixa, a query de vendas usa exatamente aquela janela (estendida para a tendência)', () => {
    // Diferente de resolverJanela(range) em qualquer fuso: prova que a fixa vence o período.
    const fixa = { desde: '2026-09-04T07:00:00.000Z', ate: '2026-10-04T06:59:59.999Z' };
    useVendas.mockClear();
    renderHook(() => useVendasSku(range, fixa));
    expect(useVendas).toHaveBeenLastCalledWith(janelaEstendida(fixa, janelaAnterior(fixa, range)), 'todos', 'todos', true);
  });

  it('sem janelaFixa, o comportamento atual não muda (resolverJanela do período)', () => {
    const j = resolverJanela(range);
    useVendas.mockClear();
    renderHook(() => useVendasSku(range));
    expect(useVendas).toHaveBeenLastCalledWith(janelaEstendida(j, janelaAnterior(j, range)), 'todos', 'todos', true);
  });
});

describe('useVendasSku — canal e faturamento da conta (TACOS do /ads)', () => {
  const range = { tipo: 'range', desde: '2026-10-01', ate: '2026-10-10' } as const;
  const fixa = { desde: '2026-10-01T03:00:00.000Z', ate: '2026-10-11T02:59:59.999Z' };
  const anteriorFixa = { desde: '2026-09-21T03:00:00.000Z', ate: '2026-10-01T02:59:59.999Z' };
  const item = (codigo: string) => ({
    id: codigo, ml_item_id: 'MLB1', variation_id: null, titulo: codigo, codigo, cor: null, ean: null,
    quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: false, cupom_vendedor: 0, custo_unitario: null,
  });
  const venda = (id: string, data: string, status: string, total: number, cupom: number | null, itens: string[]) => ({
    id, order_id: id, pack_id: null, status, date_closed: data, total_amount: total, cupom_vendedor: cupom,
    liquido: total, sale_fee_total: 0, estorno: 0, uf: 'SP', is_publiai: false, canal: 'mercado_livre',
    itens: itens.map(item),
  });

  it('/ads pede canal mercado_livre e origem todos, com a janela anterior pedida na extensão', () => {
    useVendas.mockClear();
    renderHook(() => useVendasSku(range, fixa, true, { canal: 'mercado_livre', anteriorFixa }));
    expect(useVendas).toHaveBeenLastCalledWith(janelaEstendida(fixa, anteriorFixa), 'todos', 'mercado_livre', true);
  });

  it('soma cada venda faturável uma vez com brutoDaVenda: fora do catálogo entra, cupom sai, cancelada fica fora', () => {
    vendasQ.data = [
      venda('fora', '2026-10-02T15:00:00.000Z', 'paid', 100, 10, ['NAO-CADASTRADO']), // 90: fora do catálogo, cupom do vendedor
      venda('multi', '2026-10-05T15:00:00.000Z', 'partially_refunded', 200, null, ['A', 'B', 'C']), // 200 uma vez só
      venda('reemb', '2026-10-06T15:00:00.000Z', 'refunded', 30, 0, ['A']), // faturável (STATUS_FATURAVEL)
      venda('cancel', '2026-10-07T15:00:00.000Z', 'cancelled', 50, 0, ['A']), // não faturável
      venda('ant', '2026-09-25T15:00:00.000Z', 'paid', 40, 5, ['A']), // janela anterior: 35
      venda('fora-janela', '2026-09-10T15:00:00.000Z', 'paid', 999, 0, ['A']),
    ];
    const r = renderHook(() => useVendasSku(range, fixa, true, { canal: 'mercado_livre', anteriorFixa })).result.current;
    expect(r.faturamentoConta).toEqual({ atual: 320, anterior: 35 });
    vendasQ.data = [];
  });

  it('sem janela anterior pedida, o faturamento anterior é null (nunca uma janela presumida)', () => {
    const r = renderHook(() => useVendasSku(range, fixa, true, { canal: 'mercado_livre' })).result.current;
    expect(r.faturamentoConta).toEqual({ atual: 0, anterior: null });
  });

  it('consumidores antigos: sem opções, canal e origem continuam todos', () => {
    useVendas.mockClear();
    renderHook(() => useVendasSku(range, fixa, false));
    expect(useVendas).toHaveBeenLastCalledWith(janelaEstendida(fixa, janelaAnterior(fixa, range)), 'todos', 'todos', false);
  });
});
