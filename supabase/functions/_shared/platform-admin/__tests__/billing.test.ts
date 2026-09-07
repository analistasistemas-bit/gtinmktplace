import { describe, expect, it } from 'vitest';
import { composeBillingPreview, revenueFee } from '../billing.ts';
import type { CommercialTerms } from '../types.ts';

const terms: CommercialTerms = {
  id: 'terms-1', org_id: 'org-1', starts_on: '2026-09-01', modality: 2,
  monthly_fee_cents: 60_000, revenue_bps: 500, sonar_unit_cents: 120,
  setup_fee_cents: 0, setup_due_month: null, reason: 'fixture', version: 1,
  timezone: 'America/Fortaleza', created_at: '2026-09-01T00:00:00Z', created_by: 'admin',
};

describe('billing composition', () => {
  it('compõe bruto, devolução, percentual, infraestrutura e Sonar em centavos', () => {
    expect(composeBillingPreview({ org_id: 'org-1', org_name: 'Cliente', month: '2026-09', terms,
      gross_cents: 1_000_000, refund_cents: 100_000, sonar_units: 10, sonar_cents: 1_200 }))
      .toMatchObject({ gross_cents: 1_000_000, refund_cents: 100_000, base_cents: 900_000,
        fee_cents: 45_000, sonar_units: 10, sonar_cents: 1_200, total_cents: 106_200,
        credit_balance_cents: 0, adjustments: [], sources: [], blockers: [] });
    expect(composeBillingPreview({ org_id: 'org-1', org_name: 'Cliente', month: '2026-09', terms,
      gross_cents: 1_000_000, refund_cents: 100_000, sonar_units: 10, sonar_cents: 1_200 })
      .lines.find((line) => line.key === 'revenue')?.unit_cents).toBeNull();
  });

  it('arredonda sobre base agregada', () => {
    expect(revenueFee(3, 5000)).toBe(2);
    expect(revenueFee(2, 5000)).toBe(1);
    expect(revenueFee(1, 5000)).toBe(1);
    expect(revenueFee(0, 5000)).toBe(0);
  });

  it('mantém condição zero e bloqueios explícitos', () => {
    const zero = { ...terms, monthly_fee_cents: 0, revenue_bps: 0, sonar_unit_cents: 0 };
    const preview = composeBillingPreview({ org_id: 'org-1', org_name: 'Cliente', month: '2026-09', terms: zero,
      gross_cents: 100, refund_cents: 0, sonar_units: 1, sonar_cents: 0,
      blockers: [{ code: 'refund_reconciliation_required', message: 'Concilie', sale_id: 'sale-1' }] });
    expect(preview.total_cents).toBe(0);
    expect(preview.blockers[0].sale_id).toBe('sale-1');
  });
});
