import type { CommercialTermsInput, Month } from './types.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_START = /^(\d{4}-(0[1-9]|1[0-2]))-01$/;

function fail(message: string): never {
  throw new TypeError(message);
}

function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Condições comerciais inválidas');
  return input as Record<string, unknown>;
}

function cents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) fail(`${field} deve ser um inteiro não negativo`);
  return value;
}

function month(value: unknown, field: string): Month {
  if (typeof value !== 'string' || !MONTH.test(value)) fail(`${field} deve ser YYYY-MM`);
  return value;
}

export function validateTerms(input: unknown): CommercialTermsInput {
  const value = object(input);
  if (typeof value.org_id !== 'string' || !UUID.test(value.org_id)) fail('org_id inválido');
  if (typeof value.starts_on !== 'string') fail('starts_on inválido');
  const starts = value.starts_on.match(MONTH_START);
  if (!starts) fail('starts_on deve ser o primeiro dia do mês');
  if (value.modality !== 1 && value.modality !== 2) fail('modalidade inválida');
  if (typeof value.revenue_bps !== 'number' || !Number.isSafeInteger(value.revenue_bps) || value.revenue_bps < 0 || value.revenue_bps > 10000) {
    fail('revenue_bps deve estar entre 0 e 10000');
  }
  if (typeof value.reason !== 'string' || !value.reason.trim()) fail('reason é obrigatório');

  const setupFee = cents(value.setup_fee_cents, 'setup_fee_cents');
  let setupDueMonth: Month | null;
  if (setupFee === 0) {
    if (value.setup_due_month !== null) fail('setup_due_month deve ser null quando não há implantação');
    setupDueMonth = null;
  } else {
    setupDueMonth = month(value.setup_due_month, 'setup_due_month');
    if (setupDueMonth < starts[1]) fail('setup_due_month não pode anteceder starts_on');
  }

  return {
    org_id: value.org_id,
    starts_on: value.starts_on,
    modality: value.modality,
    monthly_fee_cents: cents(value.monthly_fee_cents, 'monthly_fee_cents'),
    revenue_bps: value.revenue_bps,
    sonar_unit_cents: cents(value.sonar_unit_cents, 'sonar_unit_cents'),
    setup_fee_cents: setupFee,
    setup_due_month: setupDueMonth,
    reason: value.reason.trim(),
  };
}
