// Fixtures 100% sintéticas (repo público): nada daqui vem de organização, venda ou conta reais.
import type { BillingStatement, MonthlyReport, PaymentProfile, PeriodKpis, SeriesPoint } from '@/lib/platform-admin';

export function kpisFixture(o: Partial<PeriodKpis> = {}): PeriodKpis {
  return {
    gross_cents: 18_452_390, orders: 1_204, units: 1_868, ticket_cents: 15_326, unit_price_cents: 9_879, cancelled_orders: 37,
    refunds_cents: 412_300, seller_coupon_cents: 61_000, net_cents: 13_900_000, tax_cents: 1_476_000, cost_cents: 6_300_000,
    profit_cents: 6_124_000, covered_gross_cents: 18_452_390, profit_coverage: 1, excluded_items: 0,
    exclusions: { sem_custo: 0, aliquota_nao_confirmada: 0, frete_nao_lido: 0 }, margin: 0.332, markup: 0.97,
    ads_cost_cents: 1_020_000, profit_after_ads_cents: 5_104_000, margin_after_ads: 0.2766, markup_after_ads: 0.81,
    profit_partial: false, unavailable_reason: null, ...o,
  };
}

export function serieFixture(n: number): SeriesPoint[] {
  const meses = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  return meses.slice(12 - n).map((month, i) => ({
    month, gross_cents: 9_000_000 + i * 780_000 + (i % 3) * 400_000, profit_cents: 3_000_000 + i * 300_000,
    ads_cost_cents: 600_000 + i * 35_000, profit_after_ads_cents: 2_300_000 + i * 270_000,
    margin_after_ads: 0.2 + i * 0.007 - (i % 4) * 0.004, partial: i === 2, unavailable_reason: null,
  }));
}

export function snapshotFixture(o: Partial<BillingStatement> = {}): BillingStatement {
  return {
    id: 'stmt-1', closed_at: '2026-11-01T09:00:00Z', closed_by: 'sys', org_id: 'org-x', org_name: 'Loja Exemplo', month: '2026-10',
    timezone: 'America/Fortaleza', terms: null, gross_cents: 18_513_390, refund_cents: 412_300, base_cents: 18_101_090,
    fee_cents: 905_054, applied_bps: 500, applied_tier: 1, sonar_units: 14, sonar_cents: 16_800,
    lines: [
      { key: 'revenue', label: 'Remuneração sobre vendas', quantity: null, unit_cents: null, amount_cents: 905_054, source_type: 'sales', source_id: null },
      { key: 'sonar', label: 'Consultas Sonar', quantity: 14, unit_cents: 1_200, amount_cents: 16_800, source_type: 'sonar', source_id: null },
      { key: 'credits', label: 'Créditos de competências anteriores', quantity: null, unit_cents: null, amount_cents: -20_000, source_type: 'billing_adjustment', source_id: null },
    ],
    total_cents: 901_854, credit_cents: 20_000, credit_balance_cents: 0, adjustments: [], sources: [], revision: 'r1',
    seller_coupon_cents: 61_000, due_day: 5, blockers: [], ...o,
  };
}

export function perfilFixture(): PaymentProfile {
  return {
    beneficiary_name: 'DALUDI EXEMPLO LTDA', document: '11222333000181', bank_name: 'Banco Exemplo S.A.', branch: '0001',
    account: '12345-6', pix_key_type: 'cnpj', pix_key: '11222333000181', city: 'FORTALEZA', updated_at: '2026-10-01T00:00:00Z', updated_by: 'admin',
  };
}

export function relatorioFixture(o: { meses?: number; semAnterior?: boolean; adsIndisponivel?: boolean; atribuicaoAberta?: boolean } = {}): MonthlyReport {
  const meses = o.meses ?? 12;
  const apos = o.adsIndisponivel
    ? { ads_cost_cents: null, profit_after_ads_cents: null, margin_after_ads: null, markup_after_ads: null, unavailable_reason: 'ads_indisponivel' as const }
    : {};
  const snapshot = snapshotFixture();
  return {
    org: { id: 'org-x', nome: 'Loja Exemplo Comércio', slug: 'loja-exemplo', modality: 2 },
    month: '2026-10', previous_month: '2026-09', generated_at: '2026-11-02T15:30:00Z',
    statement: { status: 'closed', id: snapshot.id, closed_at: snapshot.closed_at, snapshot },
    summary: {
      current: kpisFixture(apos),
      previous: o.semAnterior ? null : kpisFixture({
        gross_cents: 16_100_000, orders: 1_090, units: 1_700, ticket_cents: 14_770, unit_price_cents: 9_470, cancelled_orders: 29,
        refunds_cents: 380_000, profit_after_ads_cents: 4_300_000, profit_cents: 5_200_000, margin_after_ads: 0.267, margin: 0.323, markup: 0.93, markup_after_ads: 0.76,
      }),
    },
    daily: [],
    series: serieFixture(meses).map((p) => (o.adsIndisponivel ? { ...p, ads_cost_cents: null, profit_after_ads_cents: null, margin_after_ads: null } : p)),
    top_families: {
      rows: [
        ['Conjunto Térmico Feminino Premium Inverno', 'A', 0.211, 0.352], ['Camiseta Básica Algodão Pima', 'A', 0.164, 0.301],
        ['Shorts Moletom Unissex', 'A', 0.121, 0.283], ['Legging Cintura Alta Fitness', 'B', 0.087, 0.34], ['Jaqueta Corta-vento Leve', 'B', 0.062, 0.296],
      ].map(([name, cls, share, margin], i) => ({
        key: `P${i + 1}`, name: name as string, units: 412 - i * 58, gross_cents: Math.round(18_452_390 * (share as number)), share: share as number,
        profit_cents: Math.round(18_452_390 * (share as number) * (margin as number)), margin: margin as number, markup: (margin as number) * 2.9,
        partial: i === 3, class: cls as 'A' | 'B',
      })),
      top_share: 0.645, universe_gross_cents: 18_000_000, without_code_gross_cents: 210_000, unknown_family_gross_cents: 98_000,
    },
    ads: o.adsIndisponivel ? null : {
      coverage: 'complete', days_covered: 31, days_expected: 31, cost_cents: 1_020_000, revenue_cents: 7_340_000, direct_revenue_cents: 5_000_000,
      roas: 7.2, acos: 0.139, tacos: 0.055, prints: 2_418_000, clicks: 31_700, ctr: 0.0131, cpc_cents: 32,
      attribution: o.atribuicaoAberta === false ? 'final' : 'open', attribution_open_until: '2026-10-31', attribution_expected_final_on: '2026-11-15',
    },
    traffic: { visits: 148_230, listings: 212, orders: 1_011, conversion: 0.0068, days_covered: 31, days_in_month: 31 },
    warnings: [],
  };
}
