import { describe, expect, it } from 'vitest';
import type { BillingStatement, CommercialTerms } from '@/lib/platform-admin';
import { buildBillingReport } from '@/lib/export/platform-billing';

const statement: BillingStatement = {
  id: 'statement-1',
  org_id: 'org-1',
  org_name: 'Loja Exemplo',
  month: '2026-08',
  timezone: 'America/Fortaleza',
  terms: {
    id: 'terms-1',
    org_id: 'org-1',
    starts_on: '2026-08-01',
    modality: 2,
    monthly_fee_cents: 50_000,
    revenue_bps: 500,
    sonar_unit_cents: 120,
    setup_fee_cents: 0,
    setup_due_month: null,
    reason: 'Contrato vigente',
    version: 1,
    timezone: 'America/Fortaleza',
    created_at: '2026-07-15T12:00:00Z',
    created_by: 'admin-1',
  },
  gross_cents: 1_000_000,
  refund_cents: 100_000,
  base_cents: 900_000,
  fee_cents: 45_000,
  sonar_units: 100,
  sonar_cents: 12_000,
  lines: [
    {
      key: 'revenue_fee',
      label: 'Remuneração (5%)',
      quantity: null,
      unit_cents: null,
      amount_cents: 45_000,
      source_type: 'terms',
      source_id: 'terms-1',
    },
    {
      key: 'monthly_fee',
      label: 'Infraestrutura',
      quantity: 1,
      unit_cents: 50_000,
      amount_cents: 50_000,
      source_type: 'terms',
      source_id: 'terms-1',
    },
    {
      key: 'sonar',
      label: 'Sonar',
      quantity: 100,
      unit_cents: 120,
      amount_cents: 12_000,
      source_type: 'sonar',
      source_id: null,
    },
    {
      key: 'adjustment',
      label: 'Ajuste do demonstrativo anterior',
      quantity: null,
      unit_cents: null,
      amount_cents: -800,
      source_type: 'statement',
      source_id: 'statement-0',
    },
  ],
  total_cents: 106_200,
  credit_cents: 0,
  credit_balance_cents: 0,
  adjustments: [{ origin_statement_id: 'statement-0', amount_cents: -800 }],
  sources: [
    {
      sale_id: 'sale-1',
      source_updated_at: '2026-08-10T14:00:00Z',
      gross_cents: 1_000_000,
      refunded_product_cents: 100_000,
      recognized_base_cents: 900_000,
    },
  ],
  revision: 'revision-1',
  blockers: [],
  closed_at: '2026-09-01T12:00:00Z',
  closed_by: 'admin-1',
};

describe('buildBillingReport', () => {
  it('exporta total e linhas diretamente do snapshot fechado', () => {
    const report = buildBillingReport(statement);

    expect(report.titulo).toBe('Demonstrativo Daludi · Loja Exemplo');
    expect(report.periodo).toBe('2026-08');
    expect(report.filtros).toEqual([
      'Fuso: America/Fortaleza',
      'Fechado em: 2026-09-01T12:00:00Z',
    ]);
    expect(report.kpis).toContainEqual({ label: 'Total', valor: 'R$ 1.062,00' });
    expect(report.colunas.map((column) => column.chave)).toEqual(['descricao', 'valor']);
    expect(report.linhas.map((line) => line.celulas.descricao)).toContain('Infraestrutura');
    expect(report.linhas.map((line) => line.celulas.valor)).toEqual([450, 500, 120, -8]);
    expect(
      report.linhas.reduce((sum, line) => sum + Number(line.celulas.valor), 0),
    ).toBe(statement.total_cents / 100);
  });

  it('expõe base, percentual humano, unidades/preço do Sonar e fontes do snapshot', () => {
    const report = buildBillingReport(statement);
    const items = report.blocos?.flatMap((block) => block.itens) ?? [];

    expect(items).toContainEqual({ label: 'Base de cobrança', valor: 'R$ 9.000,00' });
    expect(items).toContainEqual({ label: 'Percentual sobre receita', valor: '5%' });
    expect(items).toContainEqual({ label: 'Consultas Sonar', valor: '100' });
    expect(items).toContainEqual({ label: 'Preço unitário Sonar', valor: 'R$ 1,20' });
    expect(report.blocos?.find((block) => block.titulo === 'Fontes conciliadas')?.itens[0]).toMatchObject({
      label: 'sale-1',
    });
  });

  it('permanece idêntico quando condições atuais mudam fora do snapshot', () => {
    const before = buildBillingReport(statement);
    const currentTerms: CommercialTerms = { ...statement.terms!, revenue_bps: 900, sonar_unit_cents: 250 };
    currentTerms.revenue_bps = 1_000;

    expect(buildBillingReport(statement)).toEqual(before);
  });
});
