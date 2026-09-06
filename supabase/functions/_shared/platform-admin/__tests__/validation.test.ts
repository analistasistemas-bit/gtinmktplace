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

  it('rejeita centavos decimais, ausentes ou fora do inteiro seguro', () => {
    expect(() => validateTerms({ ...valid, monthly_fee_cents: 1.5 })).toThrow();
    expect(() => validateTerms({ ...valid, sonar_unit_cents: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
    expect(() => validateTerms({ ...valid, setup_fee_cents: undefined })).toThrow();
  });

  it('rejeita modalidade e percentual decimais', () => {
    expect(() => validateTerms({ ...valid, modality: 1.5 })).toThrow();
    expect(() => validateTerms({ ...valid, revenue_bps: 0.5 })).toThrow();
  });

  it('exige competência mensal válida para implantação cobrada', () => {
    expect(() => validateTerms({ ...valid, setup_fee_cents: 1, setup_due_month: null })).toThrow();
    expect(() => validateTerms({ ...valid, setup_fee_cents: 1, setup_due_month: '2026-13' })).toThrow();
  });
});
