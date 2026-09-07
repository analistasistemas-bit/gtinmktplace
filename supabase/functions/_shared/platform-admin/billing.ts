import type { BillingLine, BillingPreview, CommercialTerms } from './types.ts';

export type BillingInputs = {
  org_id: string;
  org_name: string;
  month: string;
  terms: CommercialTerms | null;
  gross_cents: number;
  refund_cents: number;
  sonar_units: number;
  sonar_cents: number;
  credit_cents?: number;
  credit_balance_cents?: number;
  adjustments?: BillingPreview['adjustments'];
  sources?: BillingPreview['sources'];
  blockers?: BillingPreview['blockers'];
  revision?: string;
};

export function revenueFee(baseCents: number, revenueBps: number): number {
  return Math.round(baseCents * revenueBps / 10_000);
}

export function composeBillingPreview(input: BillingInputs): BillingPreview {
  const base = Math.max(0, input.gross_cents - input.refund_cents);
  const fee = input.terms ? revenueFee(base, input.terms.revenue_bps) : 0;
  const infrastructure = input.terms?.monthly_fee_cents ?? 0;
  const setup = input.terms?.setup_due_month === input.month ? input.terms.setup_fee_cents : 0;
  const credit = input.credit_cents ?? 0;
  const lines: BillingLine[] = [
    { key: 'infrastructure', label: 'Infraestrutura', quantity: 1, unit_cents: infrastructure,
      amount_cents: infrastructure, source_type: 'commercial_terms', source_id: input.terms?.id ?? null },
    { key: 'revenue', label: 'Remuneração sobre vendas', quantity: null,
      unit_cents: null, amount_cents: fee,
      source_type: 'sales', source_id: null },
    { key: 'sonar', label: 'Consultas Sonar', quantity: input.sonar_units,
      unit_cents: input.terms?.sonar_unit_cents ?? null, amount_cents: input.sonar_cents,
      source_type: 'sonar_deliveries', source_id: null },
  ];
  if (setup > 0) lines.push({ key: 'setup', label: 'Implantação', quantity: 1,
    unit_cents: setup, amount_cents: setup, source_type: 'commercial_terms', source_id: input.terms?.id ?? null });
  if (credit > 0) lines.push({ key: 'credits', label: 'Créditos de competências anteriores', quantity: null,
    unit_cents: null, amount_cents: -credit, source_type: 'billing_adjustment', source_id: null });
  return {
    org_id: input.org_id, org_name: input.org_name, month: input.month, timezone: 'America/Fortaleza',
    terms: input.terms, gross_cents: input.gross_cents, refund_cents: input.refund_cents,
    base_cents: base, fee_cents: fee, sonar_units: input.sonar_units, sonar_cents: input.sonar_cents,
    lines, total_cents: Math.max(0, infrastructure + fee + input.sonar_cents + setup - credit),
    credit_cents: credit, credit_balance_cents: input.credit_balance_cents ?? 0,
    adjustments: input.adjustments ?? [], sources: input.sources ?? [],
    revision: input.revision ?? '', blockers: input.blockers ?? [],
  };
}
