// Sem custos carregados toda linha sairia "sem custo" (faixa vermelha) por um instante: o hook
// segura `dados` até a query de custos assentar.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { montarMapasCusto } from '@/lib/custos';
import { resolverJanela, janelaAnterior } from '@/lib/metricas';
import { janelaEstendida } from '@/lib/vendas-sku';

const { custosQ, catQ, devQ, useVendas, vendasQ, aliqQ } = vi.hoisted(() => ({
  useVendas: vi.fn(),
  aliqQ: { data: { nacional: 8, importado: 16, confirmada: true, ufEmpresa: null, internaPct: null } as unknown, isError: false },
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
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => aliqQ }));
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

describe('useVendasSku — integridade fiscal (ADR-0055: alíquota ausente não é zero)', () => {
  const range = { tipo: 'range', desde: '2026-10-01', ate: '2026-10-10' } as const;
  const fixa = { desde: '2026-10-01T03:00:00.000Z', ate: '2026-10-11T02:59:59.999Z' };
  const confirmadas = { nacional: 8, importado: 16, confirmada: true, ufEmpresa: null, internaPct: null };
  const item = (codigo: string | null, extra: Record<string, unknown> = {}) => ({
    id: codigo ?? 'x', ml_item_id: `MLB-${codigo}`, variation_id: null, titulo: codigo, codigo, cor: null, ean: null,
    quantity: 1, unit_price: 100, sale_fee: 0, is_publiai: false, cupom_vendedor: 0, ...extra,
  });
  const venda = (id: number, it: ReturnType<typeof item>, data = '2026-10-05T15:00:00.000Z', uf = 'SP') => ({
    id: String(id), order_id: id, pack_id: null, status: 'paid', date_closed: data, total_amount: 100, cupom_vendedor: 0,
    liquido: 100, sale_fee_total: 0, estorno: 0, uf, is_publiai: false, canal: 'mercado_livre', itens: [it],
  });
  const linhaCusto = (codigo: string, origem: string | null) => ({
    custo: 40, peso_gramas: 100, ml_variation_id: null, gtin: null, codigo, atualizado_em: '2026-01-01',
    familias: { ml_item_id: `MLB-${codigo}`, origem },
  });
  const render = () => renderHook(() => useVendasSku(range, fixa)).result.current;
  const preparar = (rows: Record<string, unknown>[], vendas: unknown[]) => {
    Object.assign(custosQ, { data: montarMapasCusto(rows), isLoading: false, isFetching: false, isError: false });
    vendasQ.data = vendas;
  };
  const limpar = () => { Object.assign(aliqQ, { data: confirmadas, isError: false }); vendasQ.data = []; };

  it('fiscal: alíquotas carregando → ok:false aliquotas_carregando', () => {
    preparar([linhaCusto('A', 'nacional')], [venda(1, item('A'))]);
    Object.assign(aliqQ, { data: undefined, isError: false });
    expect(render().baseFiscal).toEqual({ ok: false, motivo: 'aliquotas_carregando' });
    limpar();
  });

  it('fiscal: erro ao ler alíquotas → ok:false aliquotas_erro', () => {
    preparar([linhaCusto('A', 'nacional')], [venda(1, item('A'))]);
    Object.assign(aliqQ, { data: undefined, isError: true });
    expect(render().baseFiscal).toEqual({ ok: false, motivo: 'aliquotas_erro' });
    limpar();
  });

  it('fiscal: configuração sem confirmação (8/16 de fallback do fetch) → ok:false aliquotas_nao_confirmadas', () => {
    preparar([linhaCusto('A', 'nacional')], [venda(1, item('A'))]);
    Object.assign(aliqQ, { data: { ...confirmadas, confirmada: false } });
    expect(render().baseFiscal).toEqual({ ok: false, motivo: 'aliquotas_nao_confirmadas' });
    limpar();
  });

  it('fiscal: item com custo e família sem origem → origem_nao_resolvida com o código', () => {
    preparar([linhaCusto('A', 'nacional'), linhaCusto('B', null)], [venda(1, item('A')), venda(2, item('B'))]);
    expect(render().baseFiscal).toEqual({ ok: false, motivo: 'origem_nao_resolvida', codigos: ['B'] });
    limpar();
  });

  it('fiscal: custo congelado sem produto no catálogo (imposto sairia 0 em silêncio) → origem_nao_resolvida', () => {
    preparar([], [venda(1, item(null, { custo_congelado: 30 }))]);
    expect(render().baseFiscal).toEqual({ ok: false, motivo: 'origem_nao_resolvida', codigos: [''] });
    limpar();
  });

  // I3 pré-merge: integridade fiscal por janela — problema só na anterior não bloqueia o resultado atual.
  const anteriorFixa = { desde: '2026-09-21T03:00:00.000Z', ate: '2026-10-01T02:59:59.999Z' };
  const naAnterior = '2026-09-25T15:00:00.000Z';
  it('fiscal: venda sem origem só na anterior, sem comparação → atual ok:true e sem base anterior', () => {
    preparar([linhaCusto('A', 'nacional'), linhaCusto('B', null)], [venda(1, item('A')), venda(2, item('B'), naAnterior)]);
    const r = render();
    expect(r.baseFiscal).toEqual({ ok: true });
    expect(r.baseFiscalAnterior).toBeNull();
    limpar();
  });
  it('fiscal: venda sem origem só na anterior, com comparação → atual ok:true, anterior origem_nao_resolvida', () => {
    preparar([linhaCusto('A', 'nacional'), linhaCusto('B', null)], [venda(1, item('A')), venda(2, item('B'), naAnterior)]);
    const r = renderHook(() => useVendasSku(range, fixa, true, { canal: 'mercado_livre', anteriorFixa })).result.current;
    expect(r.baseFiscal).toEqual({ ok: true });
    expect(r.baseFiscalAnterior).toEqual({ ok: false, motivo: 'origem_nao_resolvida', codigos: ['B'] });
    limpar();
  });
  it('fiscal: alíquotas não confirmadas valem para as duas janelas', () => {
    preparar([linhaCusto('A', 'nacional')], [venda(1, item('A'))]);
    Object.assign(aliqQ, { data: { ...confirmadas, confirmada: false } });
    const r = renderHook(() => useVendasSku(range, fixa, true, { canal: 'mercado_livre', anteriorFixa })).result.current;
    expect(r.baseFiscal).toEqual({ ok: false, motivo: 'aliquotas_nao_confirmadas' });
    expect(r.baseFiscalAnterior).toEqual({ ok: false, motivo: 'aliquotas_nao_confirmadas' });
    limpar();
  });

  it('fiscal: item sem custo não entra no lucro e não bloqueia; venda fora das janelas também não', () => {
    preparar([linhaCusto('A', 'nacional')],
      [venda(1, item('A')), venda(2, item('SEM-CUSTO')), venda(3, item(null, { custo_congelado: 30 }), '2026-08-01T15:00:00.000Z')]);
    expect(render().baseFiscal).toEqual({ ok: true });
    limpar();
  });

  it('fiscal: alíquota interna da UF resolve mesmo sem origem → ok:true', () => {
    preparar([linhaCusto('B', null)], [venda(1, item('B'), undefined, 'PE')]);
    Object.assign(aliqQ, { data: { ...confirmadas, ufEmpresa: 'PE', internaPct: 4 } });
    expect(render().baseFiscal).toEqual({ ok: true });
    limpar();
  });

  it('fiscal: alíquota explicitamente zero e confirmada é válida → ok:true e imposto 0', () => {
    preparar([linhaCusto('A', 'nacional')], [venda(1, item('A'))]);
    Object.assign(aliqQ, { data: { ...confirmadas, nacional: 0 } });
    const r = render();
    expect(r.baseFiscal).toEqual({ ok: true });
    expect(r.dados!.linhas.find((l) => l.codigo === 'A')!.acc.imposto).toBe(0);
    limpar();
  });

  it('fiscal: consumidores antigos inalterados — sem alíquotas, dados seguem com o fallback 8%', () => {
    preparar([linhaCusto('A', 'nacional')], [venda(1, item('A'))]);
    Object.assign(aliqQ, { data: undefined, isError: false });
    const r = render();
    expect(r.dados!.linhas.find((l) => l.codigo === 'A')!.acc.imposto).toBe(8);
    expect(r.baseFiscal).toEqual({ ok: false, motivo: 'aliquotas_carregando' });
    limpar();
  });

  it('fiscal: sem dados montados, baseFiscal é null (nada a afirmar)', () => {
    Object.assign(custosQ, { data: undefined, isLoading: true, isError: false });
    expect(render().baseFiscal).toBeNull();
    Object.assign(custosQ, { data: montarMapasCusto([]), isLoading: false });
  });
});

// M6: "Atualizar" no /ads com alíquotas/custos em erro precisa refazê-los, senão a base fiscal fica travada.
describe('useVendasSku — refetch', () => {
  it('refaz também alíquotas e custos', async () => {
    const aliq = vi.fn().mockResolvedValue(undefined);
    const cust = vi.fn().mockResolvedValue(undefined);
    Object.assign(aliqQ as object, { refetch: aliq });
    Object.assign(custosQ, { refetch: cust });
    Object.assign(catQ, { data: [], isError: false });
    const r = renderHook(() => useVendasSku(periodo)).result.current;
    await r.refetch();
    expect(aliq).toHaveBeenCalledTimes(1);
    expect(cust).toHaveBeenCalledTimes(1);
  });
});
