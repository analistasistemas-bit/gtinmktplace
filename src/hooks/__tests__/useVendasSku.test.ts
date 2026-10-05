// Sem custos carregados toda linha sairia "sem custo" (faixa vermelha) por um instante: o hook
// segura `dados` até a query de custos assentar.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { montarMapasCusto } from '@/lib/custos';
import { resolverJanela, janelaAnterior } from '@/lib/metricas';
import { janelaEstendida } from '@/lib/vendas-sku';

const { custosQ, catQ, devQ, useVendas } = vi.hoisted(() => ({
  useVendas: vi.fn(),
  custosQ: { data: undefined as unknown, isLoading: true, isFetching: true, isError: false },
  catQ: { data: [] as unknown, isLoading: false, isFetching: false, isError: false, refetch: () => Promise.resolve() },
  devQ: { data: [] as unknown, isLoading: false, isFetching: false, isError: false, refetch: () => Promise.resolve() },
}));
const q = (data: unknown) => ({ data, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() });

vi.mock('@/hooks/useVendas', () => ({ useVendas: (...a: unknown[]) => { useVendas(...a); return q([]); } }));
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
