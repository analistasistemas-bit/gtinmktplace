import { describe, expect, it } from 'vitest';
import { validateTerms } from '../validation.ts';

const ORG = '90000000-0000-0000-0000-000000000001';
const valid = {
  org_id: ORG,
  starts_on: '2026-10-01',
  modality: 2,
  monthly_fee_cents: 60000,
  revenue_bps: 700,
  sonar_unit_cents: 0,
  setup_fee_cents: 0,
  setup_due_month: null,
  reason: 'Negociação outubro',
};

describe('validateTerms', () => {
  it('preserva valores zero e a infraestrutura da modalidade 2', () => {
    expect(validateTerms(valid)).toMatchObject({
      monthly_fee_cents: 60000,
      sonar_unit_cents: 0,
      setup_fee_cents: 0,
      modality: 2,
    });
  });

  it('rejeita percentual negativo', () => {
    expect(() => validateTerms({ ...valid, revenue_bps: -1 })).toThrow();
  });

  it('rejeita vigência que não começa no primeiro dia do mês', () => {
    expect(() => validateTerms({ ...valid, starts_on: '2026-10-15' })).toThrow();
  });
});
