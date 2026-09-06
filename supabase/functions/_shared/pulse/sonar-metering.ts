import type { CommercialTerms } from '../platform-admin/types.ts';

export type DeliveryOrigin = 'cliente' | 'daludi';
export type DeliveryClassification = {
  classification: 'cliente' | 'reabertura' | 'daludi' | 'isento';
  units: 0 | 1;
  total_cents: number;
  reason: string | null;
};

export function normalizeSonarQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function sonarQueryType(value: string): 'termo' | 'ean' {
  return /^\d{8,14}$/.test(value.replace(/\D/g, '')) && /^\s*\d[\d .-]*\s*$/.test(value) ? 'ean' : 'termo';
}

export function classifyDelivery(input: {
  origin: DeliveryOrigin;
  valid: boolean;
  alreadyDelivered: boolean;
  terms: Pick<CommercialTerms, 'sonar_unit_cents'> | null;
}): DeliveryClassification {
  if (input.origin === 'daludi') return { classification: 'daludi', units: 0, total_cents: 0, reason: 'daludi' };
  if (!input.valid) return { classification: 'isento', units: 0, total_cents: 0, reason: 'resultado_indisponivel' };
  if (input.alreadyDelivered) return { classification: 'reabertura', units: 0, total_cents: 0, reason: 'reabertura' };
  if (!input.terms) return { classification: 'isento', units: 0, total_cents: 0, reason: 'sem_condicao_comercial' };
  return { classification: 'cliente', units: 1, total_cents: input.terms.sonar_unit_cents, reason: null };
}
