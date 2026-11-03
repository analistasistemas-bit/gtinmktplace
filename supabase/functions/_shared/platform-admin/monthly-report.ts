// Relatório mensal do cliente (ADR-0193, Fatia 1): núcleo PURO — entradas já lidas, sem IO.
// Nenhuma fórmula nova de dinheiro: volume vem de `calcularResumo` (o mesmo da carteira/Resultados) e
// lucro só de `resultadoPorItem` + `lucroDoPeriodo` (ADR-0190, item calculável). `null` = indisponível.
//
// Devoluções (D-3b) — regra encontrada no dashboard do cliente (src/pages/Dashboard.tsx →
// `devolucoesConcluidasNoPeriodo`, src/lib/devolucoes.ts): estorno conta só como linha informativa,
// NÃO reduz faturamento nem lucro (`refunded`/`partially_refunded` seguem faturáveis em
// STATUS_FATURAVEL). Critério: `type='returns'` e `return_status_money='refunded'`, data
// `fechado_em ?? aberto_em` (ADR-0106), valor = `ml_vendas.estorno` do pedido. Única diferença
// deliberada: aqui o pedido conta UMA vez (dois claims do mesmo pedido não dobram o estorno), como
// o ADR-0193 D-3b exige. `calcularResumo.estornos` NÃO serve: é datado pela venda, não pelo estorno.
import { brutoDaVenda, calcularResumo, ehFaturavel } from './sales-summary.ts';
import { montarAliquotaResolver, montarCustoResolver, montarPesoResolver } from './sales-costs.ts';
import type { Venda } from './sales-types.ts';
import type { ContextoCalculo } from './metrics-repository.ts';
import type {
  AdsKpis, AfterAdsUnavailableReason, Cents, DailyPoint, FamilyRow, Month, PeriodKpis, ProfitExclusions,
  SeriesPoint, TopFamilies, TrafficKpis,
} from './types.ts';
import { lucroDoPeriodo, resultadoPorItem, type ResultadoItem } from '../notificacoes/gerencial/resultado.ts';
import { diaBrt } from '../notificacoes/gerencial/janelas.ts';

const DIA_MS = 86_400_000;
const cents = (reais: number): Cents => Math.round(reais * 100);
const chavePedido = (v: Pick<Venda, 'pack_id' | 'order_id'>) => String(v.pack_id ?? v.order_id);
const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const dataDaVenda = (v: Venda): string | null => v.date_closed ?? v.date_created;

/** Dias `YYYY-MM-DD` do mês. */
export function diasDoMes(month: Month): string[] {
  const [a, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

// ---------------------------------------------------------------------------------------------
// Componentes do mês: o que o cache (`platform_org_month_metrics` v2) guarda e o relatório lê.
// ---------------------------------------------------------------------------------------------
/** Subconjunto persistido no cache — basta para a série (D-8). */
export type ComponentesSerie = {
  gross_cents: Cents; orders: number; units: number; net_cents: Cents; tax_cents: Cents | null;
  cost_cents: Cents | null; profit_cents: Cents | null; covered_gross_cents: Cents; item_gross_cents: Cents;
  excluded_items: number;
};
export type ComponentesMes = ComponentesSerie & {
  ticket_cents: Cents; seller_coupon_cents: Cents; cancelled_orders: number; exclusions: ProfitExclusions;
};

/** Volume (calcularResumo) + lucro por item calculável. `resumo`/`itens` voltam para quem precisa do
 *  markup da carteira (computeMonth) ou do detalhe (top/diário) sem recalcular. */
export function calcularMes(vendas: Venda[], ctx: ContextoCalculo, agora: Date) {
  const resumo = calcularResumo(
    vendas, montarCustoResolver(ctx.maps), montarPesoResolver(ctx.maps), agora.getTime(),
    ctx.configOk ? montarAliquotaResolver(ctx.maps, ctx.rates) : undefined,
  );
  const itens = resultadoPorItem(vendas, ctx);
  const lp = lucroDoPeriodo(itens, ctx.configOk);
  // Catálogo ilegível: o custo não é conhecido — nada de lucro com só o custo congelado.
  const temLucro = ctx.custosOk && lp.lucro != null && lp.itensComLucro > 0;
  const faturaveis = vendas.filter((v) => ehFaturavel(v.status));
  const componentes: ComponentesMes = {
    gross_cents: cents(resumo.bruto), orders: resumo.pedidos, units: resumo.unidades,
    ticket_cents: cents(resumo.ticket), net_cents: cents(resumo.liquido),
    tax_cents: ctx.configOk ? cents(resumo.imposto) : null,
    seller_coupon_cents: cents(faturaveis.reduce((s, v) => s + (v.cupom_vendedor ?? 0), 0)),
    cancelled_orders: new Set(vendas.filter((v) => v.status === 'cancelled').map(chavePedido)).size,
    cost_cents: temLucro ? cents(lp.custoComLucro) : null,
    profit_cents: temLucro ? cents(lp.lucro!) : null,
    covered_gross_cents: temLucro ? cents(lp.vendaComLucro) : 0,
    item_gross_cents: cents(lp.vendaFaturavel),
    excluded_items: temLucro ? lp.itensSemLucro : itens.filter((it) => it.faturavel).length,
    exclusions: {
      sem_custo: cents(lp.vendaSemCusto), aliquota_nao_confirmada: cents(lp.vendaSemImposto),
      frete_nao_lido: cents(lp.vendaFreteNaoLido),
    },
  };
  return { componentes, resumo, itens };
}

export const componentesDoMes = (vendas: Venda[], ctx: ContextoCalculo, agora: Date): ComponentesMes =>
  calcularMes(vendas, ctx, agora).componentes;

type AposAds = Pick<PeriodKpis,
  'ads_cost_cents' | 'profit_after_ads_cents' | 'margin_after_ads' | 'markup_after_ads' | 'profit_partial' | 'unavailable_reason'>;

/** D-3a: Após Ads só com lucro de cobertura TOTAL (nenhum item faturável fora — `excluded_items = 0`,
 *  não "cobertura = 1": item de faturamento zero não mexe na razão) E Ads com cobertura completa. */
function aposAds(c: ComponentesSerie, ads: Pick<AdsKpis, 'coverage' | 'cost_cents'> | null): AposAds {
  const partial = c.excluded_items > 0 || (c.item_gross_cents > 0 && c.covered_gross_cents < c.item_gross_cents);
  const adsCost = ads?.coverage === 'complete' ? ads.cost_cents : null;
  const reason: AfterAdsUnavailableReason | null = c.profit_cents == null ? 'lucro_indisponivel'
    : partial ? 'lucro_parcial'
    : ads == null || ads.coverage === 'none' ? 'ads_indisponivel'
    : adsCost == null ? 'ads_cobertura_parcial'
    : null;
  const after = reason == null ? c.profit_cents! - adsCost! : null;
  return {
    ads_cost_cents: adsCost,
    profit_after_ads_cents: after,
    margin_after_ads: after != null && c.gross_cents > 0 ? after / c.gross_cents : null,
    markup_after_ads: after != null && (c.cost_cents ?? 0) > 0 ? after / c.cost_cents! : null,
    profit_partial: partial,
    unavailable_reason: reason,
  };
}

/** Razões ANTES de Ads sobre a base calculável (D-3): margem = lucro ÷ faturamento dos itens calculáveis,
 *  markup = lucro ÷ custo deles, cobertura = calculáveis ÷ faturáveis. Mesma conta no período e na série. */
function antesDeAds(c: ComponentesSerie) {
  return {
    profit_coverage: c.item_gross_cents > 0 ? c.covered_gross_cents / c.item_gross_cents : null,
    margin: c.profit_cents != null && c.covered_gross_cents > 0 ? c.profit_cents / c.covered_gross_cents : null,
    markup: c.profit_cents != null && (c.cost_cents ?? 0) > 0 ? c.profit_cents / c.cost_cents! : null,
  };
}

export function kpisDoPeriodo(c: ComponentesMes, refundsCents: Cents | null, ads: AdsKpis | null): PeriodKpis {
  return {
    gross_cents: c.gross_cents, orders: c.orders, units: c.units, ticket_cents: c.ticket_cents,
    unit_price_cents: c.units > 0 ? Math.round(c.gross_cents / c.units) : null,
    cancelled_orders: c.cancelled_orders, refunds_cents: refundsCents, seller_coupon_cents: c.seller_coupon_cents,
    net_cents: c.net_cents, tax_cents: c.tax_cents, cost_cents: c.cost_cents, profit_cents: c.profit_cents,
    covered_gross_cents: c.covered_gross_cents,
    excluded_items: c.excluded_items, exclusions: c.exclusions,
    // Saldos prontos da cascata (a UI e o PDF só formatam): comissão + frete do ML, líquido após imposto e
    // faturamento dos itens fora do lucro (mesmo conjunto de itens da cobertura).
    channel_costs_cents: c.gross_cents - c.net_cents,
    net_after_tax_cents: c.tax_cents == null ? null : c.net_cents - c.tax_cents,
    excluded_gross_cents: c.item_gross_cents - c.covered_gross_cents,
    ...antesDeAds(c),
    ...aposAds(c, ads),
  };
}

// ---------------------------------------------------------------------------------------------
// Devoluções (ver cabeçalho)
// ---------------------------------------------------------------------------------------------
export interface EstornoDevolucao {
  order_id: number | null; type: string | null; return_status_money: string | null;
  aberto_em: string | null; fechado_em: string | null; valor_estornado: number;
  /** Sem `order_id` ou sem a venda do pedido: valor desconhecido (entra como 0, igual ao dashboard, mas avisado). */
  sem_valor?: boolean;
}

/** Devoluções concluídas no período cujo valor é desconhecido (ver `sem_valor`). */
export function estornosSemValor(devs: EstornoDevolucao[], j: { desde: string; ate: string }): number {
  const de = Date.parse(j.desde), ate = Date.parse(j.ate);
  return devs.filter((d) => {
    const t = Date.parse(d.fechado_em ?? d.aberto_em ?? '');
    return d.sem_valor && d.type === 'returns' && d.return_status_money === 'refunded' && Number.isFinite(t) && t >= de && t < ate;
  }).length;
}

/** Σ estornado (centavos) das devoluções concluídas com `fechado_em ?? aberto_em` ∈ [desde, ate),
 *  um pedido uma vez só. */
export function estornosNoPeriodo(devs: EstornoDevolucao[], j: { desde: string; ate: string }): Cents {
  const de = Date.parse(j.desde), ate = Date.parse(j.ate);
  const porPedido = new Map<string, number>();
  devs.forEach((d, i) => {
    if (d.type !== 'returns' || d.return_status_money !== 'refunded') return;
    const t = Date.parse(d.fechado_em ?? d.aberto_em ?? '');
    if (!Number.isFinite(t) || t < de || t >= ate) return;
    porPedido.set(d.order_id != null ? `o:${d.order_id}` : `s:${i}`, d.valor_estornado);
  });
  return cents([...porPedido.values()].reduce((s, v) => s + v, 0));
}

// ---------------------------------------------------------------------------------------------
// Ads da conta (D-6)
// ---------------------------------------------------------------------------------------------
export interface AdsDiaRow {
  dia: string; cost: number; clicks: number; prints: number; direct_amount: number; total_amount: number; coletado_em: string;
}

/** Porta de `atribuicaoFinal` (src/lib/sku-ads.ts; paridade testada): o dia fecha quando relido 15+ dias depois. */
export const atribuicaoFinal = (dia: string, coletadoEm: string): boolean =>
  Math.round((Date.parse(`${diaBrt(new Date(Date.parse(coletadoEm)))}T00:00:00Z`) - Date.parse(`${dia}T00:00:00Z`)) / DIA_MS) >= 15;

/** `ateDia` = último dia (inclusive) das VENDAS lidas: o Ads tem de cobrir o mesmo intervalo, senão o
 *  lucro após Ads misturaria vendas até agora com investimento até D−1 (no mês corrente, a coleta de
 *  hoje ainda não existe → cobertura parcial). `null` = org sem nenhum dado de Ads (sem sync e sem linha). */
export function kpisAds(
  dias: AdsDiaRow[], sync: { conta_cobertura_desde: string | null } | null, month: Month, ateDia: string, grossCents: Cents,
): AdsKpis | null {
  const doMes = new Map(dias.filter((d) => d.dia.startsWith(`${month}-`)).map((d) => [d.dia, d]));
  if (!sync && doMes.size === 0) return null;
  const esperados = diasDoMes(month).filter((d) => d <= ateDia);
  const desde = sync?.conta_cobertura_desde ?? null;
  const completo = esperados.length > 0 && esperados.every((d) => doMes.has(d)) && desde != null && desde <= esperados[0];
  const rows = esperados.map((d) => doMes.get(d)).filter((d): d is AdsDiaRow => d != null);
  const abertos = rows.filter((d) => !atribuicaoFinal(d.dia, d.coletado_em)).map((d) => d.dia).sort();
  const ultimoAberto = abertos.at(-1) ?? null;
  const base = {
    coverage: (completo ? 'complete' : rows.length > 0 ? 'partial' : 'none') as AdsKpis['coverage'],
    days_covered: rows.length, days_expected: esperados.length,
    attribution: rows.length === 0 ? null : (abertos.length ? 'open' : 'final') as AdsKpis['attribution'],
    attribution_open_until: ultimoAberto,
    attribution_expected_final_on: ultimoAberto ? somarDias(ultimoAberto, 15) : null,
  };
  if (!completo) {
    return { ...base, cost_cents: null, revenue_cents: null, direct_revenue_cents: null, roas: null, acos: null, tacos: null,
      prints: null, clicks: null, ctr: null, cpc_cents: null };
  }
  const soma = (f: (d: AdsDiaRow) => number) => rows.reduce((s, d) => s + Number(f(d)), 0);
  const cost = soma((d) => d.cost), receita = soma((d) => d.total_amount);
  const prints = soma((d) => d.prints), clicks = soma((d) => d.clicks);
  return {
    ...base,
    cost_cents: cents(cost), revenue_cents: cents(receita), direct_revenue_cents: cents(soma((d) => d.direct_amount)),
    roas: cost > 0 ? receita / cost : null,
    acos: receita > 0 ? cost / receita : null,
    tacos: grossCents > 0 ? cents(cost) / grossCents : null,
    prints, clicks,
    ctr: prints > 0 ? clicks / prints : null,
    cpc_cents: clicks > 0 ? Math.round((cost * 100) / clicks) : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Visitas e conversão dos anúncios acompanhados (D-5, critérios do ADR-0176 / vitrine_resumo)
// ---------------------------------------------------------------------------------------------
export interface VisitaDiaRow { ml_item_id: string; dia: string; visitas: number | null; estado: string }

export function trafego(visitas: VisitaDiaRow[], vendas: Venda[], month: Month): TrafficKpis | null {
  const ok = visitas.filter((v) => v.estado === 'ok' && v.dia.startsWith(`${month}-`));
  if (ok.length === 0) return null;
  const pares = new Set(ok.map((v) => `${v.ml_item_id}|${v.dia}`));
  const pedidos = new Set<string>();
  for (const s of vendas) {
    const data = s.date_closed;
    if (!ehFaturavel(s.status) || !data) continue;
    const dia = diaBrt(new Date(Date.parse(data)));
    for (const it of s.itens) {
      // kit conta no MLB do kit e 1 pedido por pack (o ML emite 1 order por componente)
      const mlb = s.kit_item_id ?? it.ml_item_id;
      if (mlb == null || !pares.has(`${mlb}|${dia}`)) continue;
      pedidos.add(s.kit_item_id != null ? `p:${s.pack_id ?? s.id}` : `o:${s.id}`);
    }
  }
  const visits = ok.reduce((s, v) => s + Number(v.visitas ?? 0), 0);
  return {
    visits, listings: new Set(ok.map((v) => v.ml_item_id)).size, orders: pedidos.size,
    conversion: visits > 0 ? pedidos.size / visits : null,
    days_covered: new Set(ok.map((v) => v.dia)).size, days_in_month: diasDoMes(month).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Principais produtos do mês (D-7): ABC por família
// ---------------------------------------------------------------------------------------------
export type FamiliaDoCodigo = { codigoPai?: string | null; nomeFamilia: string | null };
const ABC_A = 0.8, ABC_B = 0.95; // LIMITES.abcA/abcB de src/lib/vendas-sku.ts
const TOP = 5;

export function topFamilias(itens: ResultadoItem[], catalogo: Map<string, FamiliaDoCodigo>): TopFamilies {
  type Acc = { key: string; name: string | null; units: number; venda: number; lucro: number; coberto: number; custo: number; calc: number; fora: number };
  const grupos = new Map<string, Acc>();
  let semCodigo = 0, desconhecida = 0, total = 0;
  for (const it of itens) {
    if (!it.faturavel) continue;
    total += it.venda;
    const codigo = it.codigo?.trim() || null;
    if (!codigo) { semCodigo += it.venda; continue; }
    const fam = catalogo.get(codigo);
    const key = fam?.codigoPai?.trim() || null;
    if (!key) { desconhecida += it.venda; continue; }
    const g = grupos.get(key) ?? { key, name: fam!.nomeFamilia, units: 0, venda: 0, lucro: 0, coberto: 0, custo: 0, calc: 0, fora: 0 };
    g.units += it.quantidade;
    g.venda += it.venda;
    if (it.lucro != null) { g.lucro += it.lucro; g.coberto += it.venda; g.custo += it.custo ?? 0; g.calc += 1; } else g.fora += 1;
    grupos.set(key, g);
  }
  const totalCents = cents(total);
  const ordenadas = [...grupos.values()].map((g) => ({ g, gross: cents(g.venda) }))
    .sort((a, b) => b.gross - a.gross || (a.g.key < b.g.key ? -1 : a.g.key > b.g.key ? 1 : 0));
  const universo = ordenadas.reduce((s, x) => s + x.gross, 0);
  let acum = 0;
  const rows = ordenadas.map(({ g, gross }): FamilyRow => {
    const antes = universo > 0 ? acum / universo : 0;
    acum += gross;
    const profit = g.calc > 0 ? cents(g.lucro) : null;
    const custo = cents(g.custo), coberto = cents(g.coberto);
    return {
      key: g.key, name: g.name, units: g.units, gross_cents: gross,
      share: totalCents > 0 ? gross / totalCents : 0,
      profit_cents: profit,
      margin: profit != null && coberto > 0 ? profit / coberto : null,
      markup: profit != null && custo > 0 ? profit / custo : null,
      partial: g.fora > 0,
      class: gross <= 0 ? null : antes < ABC_A ? 'A' : antes < ABC_B ? 'B' : 'C',
    };
  }).slice(0, TOP);
  return {
    rows, top_share: rows.reduce((s, r) => s + r.share, 0), universe_gross_cents: universo,
    without_code_gross_cents: cents(semCodigo), unknown_family_gross_cents: cents(desconhecida),
  };
}

// ---------------------------------------------------------------------------------------------
// Diário e série
// ---------------------------------------------------------------------------------------------
/** Dia i do mês × dia i do anterior. `adsCompletos`: linhas de Ads do mês SÓ quando o lucro após Ads do
 *  MÊS está disponível (`kpisDoPeriodo(...).unavailable_reason === null`); senão null. Por defesa, repete
 *  a elegibilidade mensal (≥ 1 item calculável e nenhum fora) e dia sem Ads coletado sai null. */
export function diario(
  month: Month, vendas: Venda[], itens: ResultadoItem[], vendasAnterior: Venda[], adsCompletos: AdsDiaRow[] | null, agora: Date,
): DailyPoint[] {
  const hoje = diaBrt(agora);
  const dias = diasDoMes(month).filter((d) => d <= hoje);
  const porDia = (vs: Venda[]) => {
    const m = new Map<string, { bruto: number; pedidos: Set<string> }>();
    for (const v of vs) {
      const data = dataDaVenda(v);
      if (!ehFaturavel(v.status) || !data) continue;
      const d = diaBrt(new Date(Date.parse(data)));
      const acc = m.get(d) ?? { bruto: 0, pedidos: new Set<string>() };
      acc.bruto += brutoDaVenda(v);
      acc.pedidos.add(chavePedido(v));
      m.set(d, acc);
    }
    return m;
  };
  const atual = porDia(vendas), anterior = porDia(vendasAnterior);
  const mesAnterior = (() => {
    const [a, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 2, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  })();
  const diasAnterior = new Set(diasDoMes(mesAnterior));
  const fat = itens.filter((it) => it.faturavel);
  const comAposAds = adsCompletos != null && fat.length > 0 && fat.every((it) => it.lucro != null);
  const lucroPorDia = new Map<string, number>();
  if (comAposAds) {
    const diaDaOrder = new Map(vendas.map((v) => [v.order_id, dataDaVenda(v)]));
    for (const it of fat) {
      const data = diaDaOrder.get(it.orderId);
      if (!data) continue;
      const d = diaBrt(new Date(Date.parse(data)));
      lucroPorDia.set(d, (lucroPorDia.get(d) ?? 0) + it.lucro!);
    }
  }
  const adsPorDia = new Map((adsCompletos ?? []).map((a) => [a.dia, Number(a.cost)]));
  return dias.map((day) => {
    const a = atual.get(day);
    const prev = `${mesAnterior}${day.slice(7)}`;
    return {
      day, gross_cents: cents(a?.bruto ?? 0), orders: a?.pedidos.size ?? 0,
      profit_after_ads_cents: comAposAds && adsPorDia.has(day) ? cents(lucroPorDia.get(day) ?? 0) - cents(adsPorDia.get(day)!) : null,
      prev_gross_cents: diasAnterior.has(prev) ? cents(anterior.get(prev)?.bruto ?? 0) : null,
    };
  });
}

export type PontoMes = { month: Month; componentes: ComponentesSerie | null; unavailable_reason: 'volume' | 'leitura' | null };

/** Até 12 meses ascendentes terminando na competência, a partir do 1º mês com venda (ou indisponível:
 *  "não sei" não é "sem venda"). */
export function serieMensal(pontos: PontoMes[], adsPorMes: Map<Month, Pick<AdsKpis, 'coverage' | 'cost_cents'> | null>): SeriesPoint[] {
  const inicio = pontos.findIndex((p) => p.componentes == null || p.componentes.orders > 0);
  if (inicio < 0) return [];
  return pontos.slice(inicio).map((p) => {
    const c = p.componentes;
    if (!c) {
      return { month: p.month, gross_cents: null, profit_cents: null, ads_cost_cents: null, profit_after_ads_cents: null,
        margin_after_ads: null, margin: null, markup: null, profit_coverage: null, partial: false,
        unavailable_reason: p.unavailable_reason ?? 'leitura' };
    }
    const pos = aposAds(c, adsPorMes.get(p.month) ?? null);
    return {
      month: p.month, gross_cents: c.gross_cents, profit_cents: c.profit_cents, ads_cost_cents: pos.ads_cost_cents,
      profit_after_ads_cents: pos.profit_after_ads_cents, margin_after_ads: pos.margin_after_ads,
      ...antesDeAds(c), partial: pos.profit_partial, unavailable_reason: null,
    };
  });
}
