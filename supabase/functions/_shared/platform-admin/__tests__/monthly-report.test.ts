import { describe, expect, it } from 'vitest';
import {
  atribuicaoFinal, componentesDoMes, diario, estornosNoPeriodo, kpisAds, kpisDoPeriodo, serieMensal, topFamilias, trafego,
  type AdsDiaRow, type EstornoDevolucao,
} from '../monthly-report.ts';
import { montarMapasCusto } from '../sales-costs.ts';
import type { ContextoCalculo } from '../metrics-repository.ts';
import type { Venda, VendaItem } from '../sales-types.ts';
import { resultadoPorItem } from '../../notificacoes/gerencial/resultado.ts';
import { atribuicaoFinal as atribuicaoFinalTela } from '../../../../../src/lib/sku-ads';

type Row = Record<string, unknown>;

const item = (patch: Partial<VendaItem> = {}): VendaItem => ({
  id: 'i1', ml_item_id: 'MLB1', variation_id: 1, titulo: 'Produto 1', codigo: 'SKU1', cor: null, ean: null,
  quantity: 2, unit_price: 50, sale_fee: 0, is_publiai: true, custo_congelado: 20, ...patch,
});

const venda = (patch: Partial<Venda> = {}): Venda => ({
  id: 'v1', org_id: 'org-a', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-10-20T12:00:00-03:00', date_created: null, comprador_nick: null, comprador_nome: null,
  comprador_id: null, uf: 'SP', cidade: null, total_amount: 100, paid_amount: 100, liquido: 80,
  sale_fee_total: 10, frete_vendedor: 10, estorno: null, money_release_date: null, sacado_em: null,
  sacado_por: null, atualizado_em: '2026-10-20T12:00:00-03:00', currency: 'BRL', shipping_id: null,
  shipping_status: null, shipping_substatus: null, shipping_logistic: null, tracking_number: null,
  is_publiai: true, tem_devolucao: false, itens: [item()], ...patch,
});

const catRow = (mlItemId: string, varId: number, custo: number, peso: number, origem = 'nacional'): Row => ({
  custo, peso_gramas: peso, ml_variation_id: String(varId), gtin: null, codigo: null,
  atualizado_em: '2026-01-01', familias: { ml_item_id: mlItemId, origem },
});
const ctx: ContextoCalculo = {
  maps: montarMapasCusto([catRow('MLB1', 1, 25, 300), catRow('MLB2', 2, 15, 100)]),
  rates: { nacional: 8, importado: 16, ufEmpresa: 'CE', internaPct: 8 }, custosOk: true, configOk: true,
};
const AGORA = new Date('2026-11-02T12:00:00-03:00');

const diasOut = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
const adsDia = (dia: string, patch: Partial<AdsDiaRow> = {}): AdsDiaRow => ({
  dia, cost: 1, clicks: 10, prints: 100, direct_amount: 3, total_amount: 5, coletado_em: '2026-11-20T12:00:00-03:00', ...patch,
});
const adsCompleto = kpisAds(diasOut.map((d) => adsDia(d)), { conta_cobertura_desde: '2026-09-01' }, '2026-10', '2026-11-02', 10_000);

describe('componentesDoMes + kpisDoPeriodo', () => {
  it('venda totalmente calculável: lucro igual ao do gerencial e Após Ads com Ads completo', () => {
    const c = componentesDoMes([venda()], ctx, AGORA);
    expect(c).toMatchObject({ gross_cents: 10_000, orders: 1, units: 2, net_cents: 8_000, tax_cents: 800,
      profit_cents: 3_200, cost_cents: 4_000, covered_gross_cents: 10_000, item_gross_cents: 10_000, excluded_items: 0 });
    const k = kpisDoPeriodo(c, 0, adsCompleto);
    expect(k.profit_partial).toBe(false);
    expect(k.ads_cost_cents).toBe(3_100); // 31 dias × R$ 1
    expect(k.profit_after_ads_cents).toBe(100);
    expect(k.margin_after_ads).toBeCloseTo(0.01);
    expect(k.markup_after_ads).toBeCloseTo(100 / 4_000);
    expect(k.unavailable_reason).toBeNull();
    expect(k.ticket_cents).toBe(10_000);
    expect(k.unit_price_cents).toBe(5_000);
  });

  it('cupom do vendedor: faturamento já sem cupom e ponte do cupom separada', () => {
    const v = venda({ total_amount: 100, cupom_vendedor: 10, liquido: 70, itens: [item({ quantity: 1, unit_price: 100, cupom_vendedor: 10 })] });
    const c = componentesDoMes([v], ctx, AGORA);
    expect(c.gross_cents).toBe(9_000);
    expect(c.seller_coupon_cents).toBe(1_000);
    expect(c.item_gross_cents).toBe(9_000);
    expect(c.covered_gross_cents).toBe(9_000);
  });

  it('pack parcialmente custeado: lucro parcial só dos itens calculáveis, sem Após Ads', () => {
    const pack = [
      venda({ id: 'a1', order_id: 11, pack_id: 900, total_amount: 60, liquido: 40, itens: [item({ id: 'a', quantity: 1, unit_price: 60, custo_congelado: 20 })] }),
      venda({ id: 'a2', order_id: 12, pack_id: 900, total_amount: 40, liquido: 30, itens: [item({ id: 'b', ml_item_id: 'MLB3', variation_id: 3, codigo: 'SKU3', quantity: 1, unit_price: 40, custo_congelado: null })] }),
    ];
    const c = componentesDoMes(pack, ctx, AGORA);
    const itens = resultadoPorItem(pack, ctx).filter((it) => it.lucro != null);
    expect(c.orders).toBe(1);
    expect(c.excluded_items).toBe(1);
    expect(c.covered_gross_cents).toBe(6_000);
    expect(c.exclusions).toEqual({ sem_custo: 4_000, aliquota_nao_confirmada: 0, frete_nao_lido: 0 });
    expect(c.profit_cents).toBe(Math.round(itens.reduce((s, it) => s + it.lucro!, 0) * 100));
    const k = kpisDoPeriodo(c, null, adsCompleto);
    expect(k.profit_partial).toBe(true);
    expect(k.profit_coverage).toBeCloseTo(0.6);
    expect(k.margin).toBeCloseTo(c.profit_cents! / 6_000);
    expect(k.profit_after_ads_cents).toBeNull();
    expect(k.unavailable_reason).toBe('lucro_parcial');
  });

  it('venda calculável de R$ 100 + item de faturamento zero sem custo → parcial e Após Ads indisponível', () => {
    const v = venda({ itens: [item(), item({ id: 'z', ml_item_id: 'MLB9', variation_id: 9, codigo: 'BRINDE', quantity: 1, unit_price: 10, cupom_vendedor: 10, custo_congelado: null })], cupom_vendedor: 10, total_amount: 110 });
    const c = componentesDoMes([v], ctx, AGORA);
    expect(c.gross_cents).toBe(10_000);
    expect(c.covered_gross_cents).toBe(10_000);
    expect(c.item_gross_cents).toBe(10_000);
    expect(c.excluded_items).toBe(1);
    const k = kpisDoPeriodo(c, null, adsCompleto);
    expect(k.profit_coverage).toBe(1);
    expect(k.profit_partial).toBe(true);
    expect(k.profit_after_ads_cents).toBeNull();
    expect(k.unavailable_reason).toBe('lucro_parcial');
  });

  it('alíquota não confirmada: imposto e lucro indisponíveis (nunca 8/16 %)', () => {
    const c = componentesDoMes([venda()], { ...ctx, configOk: false }, AGORA);
    expect(c.tax_cents).toBeNull();
    expect(c.profit_cents).toBeNull();
    expect(c.exclusions.aliquota_nao_confirmada).toBe(10_000);
    expect(kpisDoPeriodo(c, null, adsCompleto).unavailable_reason).toBe('lucro_indisponivel');
  });

  it('mês sem venda: zeros de volume, lucro indisponível (nunca zero)', () => {
    const c = componentesDoMes([], ctx, AGORA);
    expect(c).toMatchObject({ gross_cents: 0, orders: 0, profit_cents: null, cost_cents: null, excluded_items: 0 });
    const k = kpisDoPeriodo(c, 0, null);
    expect(k.profit_coverage).toBeNull();
    expect(k.margin).toBeNull();
    expect(k.unit_price_cents).toBeNull();
    expect(k.unavailable_reason).toBe('lucro_indisponivel');
  });

  it('pedido cancelado conta à parte e fica fora do faturamento', () => {
    const c = componentesDoMes([venda(), venda({ id: 'c', order_id: 2, status: 'cancelled' })], ctx, AGORA);
    expect(c.gross_cents).toBe(10_000);
    expect(c.cancelled_orders).toBe(1);
  });
});

describe('estornosNoPeriodo (ADR-0106, paridade com devolucoesConcluidasNoPeriodo)', () => {
  const dev = (patch: Partial<EstornoDevolucao>): EstornoDevolucao => ({
    order_id: 1, type: 'returns', return_status_money: 'refunded', aberto_em: '2026-10-05T10:00:00Z', fechado_em: '2026-10-06T10:00:00Z', valor_estornado: 30, ...patch,
  });
  const out = { desde: '2026-10-01T00:00:00-03:00', ate: '2026-11-01T00:00:00-03:00' };
  const set = { desde: '2026-09-01T00:00:00-03:00', ate: '2026-10-01T00:00:00-03:00' };

  it('reembolso parcial conta pelo valor estornado; não reembolsado e mediação ficam fora', () => {
    expect(estornosNoPeriodo([dev({}), dev({ order_id: 2, return_status_money: 'retained' }), dev({ order_id: 3, type: 'mediations' })], out)).toBe(3_000);
  });

  it('devolução de venda de mês anterior estornada no mês conta no mês do estorno', () => {
    const d = dev({ aberto_em: '2026-09-25T10:00:00Z', fechado_em: '2026-10-03T10:00:00Z', valor_estornado: 70.5 });
    expect(estornosNoPeriodo([d], out)).toBe(7_050);
    expect(estornosNoPeriodo([d], set)).toBe(0);
  });

  it('dois claims do mesmo pedido não contam o estorno duas vezes', () => {
    expect(estornosNoPeriodo([dev({}), dev({ fechado_em: '2026-10-09T10:00:00Z' })], out)).toBe(3_000);
  });

  it('sem fechado_em usa aberto_em (linha antiga)', () => {
    expect(estornosNoPeriodo([dev({ fechado_em: null, aberto_em: '2026-10-10T00:00:00Z' })], out)).toBe(3_000);
  });
});

describe('kpisAds', () => {
  it('org sem Ads (sem sync e sem linha) → null', () => {
    expect(kpisAds([], null, '2026-10', '2026-11-02', 10_000)).toBeNull();
  });

  it('cobertura completa: soma o mês e calcula as razões sobre os agregados', () => {
    expect(adsCompleto).toMatchObject({
      coverage: 'complete', days_covered: 31, days_expected: 31, cost_cents: 3_100, revenue_cents: 15_500,
      direct_revenue_cents: 9_300, prints: 3_100, clicks: 310, cpc_cents: 10, attribution: 'final',
    });
    expect(adsCompleto!.roas).toBeCloseTo(5);
    expect(adsCompleto!.acos).toBeCloseTo(0.2);
    expect(adsCompleto!.tacos).toBeCloseTo(0.31);
    expect(adsCompleto!.ctr).toBeCloseTo(0.1);
  });

  it('cobertura parcial (dia faltando): métricas indisponíveis e Após Ads cai com motivo', () => {
    const a = kpisAds(diasOut.slice(1).map((d) => adsDia(d)), { conta_cobertura_desde: '2026-10-02' }, '2026-10', '2026-11-02', 10_000);
    expect(a).toMatchObject({ coverage: 'partial', days_covered: 30, cost_cents: null, roas: null });
    const k = kpisDoPeriodo(componentesDoMes([venda()], ctx, AGORA), null, a);
    expect(k.ads_cost_cents).toBeNull();
    expect(k.unavailable_reason).toBe('ads_cobertura_parcial');
  });

  it('sync sem nenhum dia no mês → cobertura none', () => {
    expect(kpisAds([], { conta_cobertura_desde: null }, '2026-10', '2026-11-02', 10_000)).toMatchObject({ coverage: 'none', cost_cents: null });
  });

  it('atribuição aberta: dia relido há menos de 15 dias → open, com prazo previsto', () => {
    const rows = diasOut.map((d) => adsDia(d, { coletado_em: '2026-11-01T12:00:00-03:00' }));
    const a = kpisAds(rows, { conta_cobertura_desde: '2026-01-01' }, '2026-10', '2026-11-02', 10_000);
    expect(a!.attribution).toBe('open');
    expect(a!.cost_cents).toBe(3_100); // o custo é definitivo
    expect(a!.attribution_open_until).toBe('2026-10-31');
    expect(a!.attribution_expected_final_on).toBe('2026-11-15');
  });

  it('mês corrente: exige Ads no MESMO intervalo das vendas (até hoje); sem a coleta de hoje → parcial', () => {
    const a = kpisAds(['2026-11-01'].map((d) => adsDia(d)), { conta_cobertura_desde: '2026-01-01' }, '2026-11', '2026-11-02', 0);
    expect(a).toMatchObject({ coverage: 'partial', days_expected: 2, days_covered: 1, cost_cents: null });
    const b = kpisAds(['2026-11-01', '2026-11-02'].map((d) => adsDia(d)), { conta_cobertura_desde: '2026-01-01' }, '2026-11', '2026-11-02', 0);
    expect(b).toMatchObject({ coverage: 'complete', days_expected: 2, tacos: null });
  });

  it('atribuicaoFinal tem paridade com a tela (src/lib/sku-ads)', () => {
    for (const [dia, col] of [['2026-10-01', '2026-10-16T02:00:00Z'], ['2026-10-01', '2026-10-16T03:00:00Z'], ['2026-10-31', '2026-11-15T12:00:00Z']]) {
      expect(atribuicaoFinal(dia, col)).toBe(atribuicaoFinalTela(dia, col));
    }
  });
});

describe('topFamilias (ABC por família, D-7)', () => {
  const catalogo = new Map([
    ['A1', { codigoPai: 'PA', nomeFamilia: 'Família A' }], ['A2', { codigoPai: 'PA', nomeFamilia: 'Família A' }],
    ['B1', { codigoPai: 'PB', nomeFamilia: 'Família B' }], ['C1', { codigoPai: 'PC', nomeFamilia: 'Família C' }],
  ]);
  const v = (id: number, codigo: string | null, preco: number, custo: number | null = 10) => venda({
    id: `v${id}`, order_id: id, total_amount: preco, liquido: preco * 0.8,
    // sem custo: MLB fora do catálogo (senão o resolver acha o custo do catálogo)
    itens: [item({ id: `i${id}`, codigo, quantity: 1, unit_price: preco, custo_congelado: custo,
      ...(custo == null ? { ml_item_id: 'MLBX', variation_id: 99 } : {}) })],
  });

  it('agrupa por código do pai; sem código e desconhecida ficam fora do ranking', () => {
    const itens = resultadoPorItem([v(1, 'A1', 50), v(2, 'A2', 30), v(3, 'B1', 15), v(4, 'C1', 5), v(5, null, 40), v(6, 'ZZ', 60)], ctx);
    const t = topFamilias(itens, catalogo);
    expect(t.rows.map((r) => [r.key, r.gross_cents, r.class])).toEqual([['PA', 8_000, 'A'], ['PB', 1_500, 'B'], ['PC', 500, 'C']]);
    expect(t.universe_gross_cents).toBe(10_000);
    expect(t.without_code_gross_cents).toBe(4_000);
    expect(t.unknown_family_gross_cents).toBe(6_000);
    expect(t.rows[0]).toMatchObject({ name: 'Família A', units: 2, share: 0.4 }); // % do mês (R$ 200)
    expect(t.top_share).toBeCloseTo(0.5);
  });

  it('empate de faturamento: desempate determinístico pela chave', () => {
    const t = topFamilias(resultadoPorItem([v(1, 'B1', 20), v(2, 'A1', 20)], ctx), catalogo);
    expect(t.rows.map((r) => r.key)).toEqual(['PA', 'PB']);
  });

  it('família com item sem custo: lucro parcial marcado; sem nenhum calculável → lucro null', () => {
    const t = topFamilias(resultadoPorItem([v(1, 'A1', 50), v(2, 'A2', 30, null), v(3, 'B1', 10, null)], ctx), catalogo);
    expect(t.rows[0]).toMatchObject({ key: 'PA', partial: true });
    expect(t.rows[0].profit_cents).not.toBeNull();
    expect(t.rows[1]).toMatchObject({ key: 'PB', profit_cents: null, margin: null, markup: null, partial: true });
  });

  it('corta em 5 com a classe calculada antes do corte', () => {
    const cat = new Map(Array.from({ length: 7 }, (_, i) => [`S${i}`, { codigoPai: `P${i}`, nomeFamilia: null }]));
    const t = topFamilias(resultadoPorItem(Array.from({ length: 7 }, (_, i) => v(i + 1, `S${i}`, 70 - i * 10)), ctx), cat);
    expect(t.rows).toHaveLength(5);
    expect(t.universe_gross_cents).toBe(28_000);
  });
});

describe('trafego (D-5, critérios ADR-0176)', () => {
  it('só pares ok; anúncio com 0 visitas conta; kit conta 1 pedido por pack', () => {
    const visitas = [
      { ml_item_id: 'MLB1', dia: '2026-10-20', visitas: 40, estado: 'ok' },
      { ml_item_id: 'MLB2', dia: '2026-10-20', visitas: 0, estado: 'ok' },
      { ml_item_id: 'MLB3', dia: '2026-10-20', visitas: 99, estado: 'pendente' },
      { ml_item_id: 'KIT', dia: '2026-10-21', visitas: 10, estado: 'ok' },
    ];
    const vendas = [
      venda({ id: 'a', order_id: 1 }),
      venda({ id: 'b', order_id: 2, itens: [item({ ml_item_id: 'MLB3' })] }), // par não-ok
      venda({ id: 'k1', order_id: 3, pack_id: 77, kit_item_id: 'KIT', date_closed: '2026-10-21T10:00:00-03:00' }),
      venda({ id: 'k2', order_id: 4, pack_id: 77, kit_item_id: 'KIT', date_closed: '2026-10-21T10:00:00-03:00', itens: [item({ ml_item_id: 'MLB2' })] }),
      venda({ id: 'x', order_id: 5, status: 'cancelled' }),
    ];
    expect(trafego(visitas, vendas, '2026-10')).toEqual({ visits: 50, listings: 3, orders: 2, conversion: 2 / 50, days_covered: 2, days_in_month: 31 });
  });

  it('sem par ok no mês → null', () => {
    expect(trafego([{ ml_item_id: 'MLB1', dia: '2026-10-20', visitas: 3, estado: 'falha' }], [], '2026-10')).toBeNull();
  });
});

describe('diario', () => {
  it('dia i do mês contra o dia i do anterior; dia inexistente no anterior = null', () => {
    const atual = [venda({ date_closed: '2026-10-31T10:00:00-03:00' }), venda({ id: 'b', order_id: 2, date_closed: '2026-10-01T01:00:00-03:00' })];
    const anterior = [venda({ id: 'p', order_id: 3, date_closed: '2026-09-01T10:00:00-03:00', total_amount: 50 })];
    const d = diario('2026-10', atual, resultadoPorItem(atual, ctx), anterior, null, AGORA);
    expect(d).toHaveLength(31);
    expect(d[0]).toMatchObject({ day: '2026-10-01', gross_cents: 10_000, orders: 1, prev_gross_cents: 5_000, profit_after_ads_cents: null });
    expect(d[1]).toMatchObject({ gross_cents: 0, prev_gross_cents: 0 });
    expect(d[30]).toMatchObject({ day: '2026-10-31', gross_cents: 10_000, prev_gross_cents: null });
  });

  it('lucro após Ads por dia só quando o mês tem cobertura total e Ads completo', () => {
    const atual = [venda()];
    const ads = diasOut.map((dia) => adsDia(dia));
    const d = diario('2026-10', atual, resultadoPorItem(atual, ctx), [], ads, AGORA);
    expect(d[19]).toMatchObject({ day: '2026-10-20', profit_after_ads_cents: 3_200 - 100 });
    expect(d[0].profit_after_ads_cents).toBe(-100);
  });

  it('dia sem Ads coletado → lucro após Ads do dia null (nunca custo zero)', () => {
    const atual = [venda()];
    const ads = diasOut.filter((d) => d !== '2026-10-05').map((dia) => adsDia(dia));
    const d = diario('2026-10', atual, resultadoPorItem(atual, ctx), [], ads, AGORA);
    expect(d[4].profit_after_ads_cents).toBeNull();
    expect(d[19].profit_after_ads_cents).toBe(3_100);
  });

  it('mês sem venda: sem lucro após Ads no diário, mesmo com Ads (elegibilidade mensal)', () => {
    const d = diario('2026-10', [], [], [], diasOut.map((dia) => adsDia(dia)), AGORA);
    expect(d.every((x) => x.profit_after_ads_cents === null)).toBe(true);
  });

  it('mês corrente: dias só até hoje', () => {
    expect(diario('2026-11', [], [], [], null, AGORA)).toHaveLength(2);
  });
});

describe('serieMensal', () => {
  const comp = (gross: number, extra = {}) => ({
    gross_cents: gross, orders: gross > 0 ? 1 : 0, profit_cents: gross > 0 ? 1_000 : null, cost_cents: gross > 0 ? 2_000 : null,
    covered_gross_cents: gross, item_gross_cents: gross, excluded_items: 0, ...extra,
  });

  it('começa no 1º mês com venda, mantém ponto indisponível e calcula Após Ads quando possível', () => {
    const s = serieMensal([
      { month: '2026-07', componentes: comp(0), unavailable_reason: null },
      { month: '2026-08', componentes: comp(5_000), unavailable_reason: null },
      { month: '2026-09', componentes: null, unavailable_reason: 'volume' },
      { month: '2026-10', componentes: comp(10_000, { excluded_items: 2 }), unavailable_reason: null },
    ], new Map([['2026-08', { coverage: 'complete', cost_cents: 300 } as never]]));
    expect(s.map((p) => p.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(s[0]).toMatchObject({ gross_cents: 5_000, ads_cost_cents: 300, profit_after_ads_cents: 700, partial: false });
    expect(s[0].margin_after_ads).toBeCloseTo(0.14);
    expect(s[1]).toMatchObject({ gross_cents: null, profit_cents: null, unavailable_reason: 'volume' });
    expect(s[2]).toMatchObject({ partial: true, profit_after_ads_cents: null, ads_cost_cents: null });
  });
});
