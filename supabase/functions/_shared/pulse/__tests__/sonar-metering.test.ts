import { describe, expect, it } from 'vitest';
import { classifyDelivery, normalizeSonarQuery, sonarQueryType } from '../sonar-metering.ts';

describe('sonar metering', () => {
  it('normaliza intenção e distingue EAN sem alterar termo comum', () => {
    expect(normalizeSonarQuery('  Capa   Azul ')).toBe('capa azul');
    expect(sonarQueryType('7891234567890')).toBe('ean');
    expect(sonarQueryType('capa 123')).toBe('termo');
  });

  it('isenta Daludi e resultado indisponível', () => {
    expect(classifyDelivery({ origin: 'daludi', valid: true, alreadyDelivered: false, terms: null }))
      .toMatchObject({ units: 0, reason: 'daludi' });
    expect(classifyDelivery({ origin: 'cliente', valid: false, alreadyDelivered: false, terms: { sonar_unit_cents: 100 } }))
      .toMatchObject({ units: 0, reason: 'resultado_indisponivel' });
  });

  it('cobra uma vez, preserva preço zero e isenta reabertura', () => {
    expect(classifyDelivery({ origin: 'cliente', valid: true, alreadyDelivered: false, terms: { sonar_unit_cents: 0 } }))
      .toMatchObject({ classification: 'cliente', units: 1, total_cents: 0 });
    expect(classifyDelivery({ origin: 'cliente', valid: true, alreadyDelivered: true, terms: { sonar_unit_cents: 900 } }))
      .toMatchObject({ classification: 'reabertura', units: 0, total_cents: 0 });
    expect(classifyDelivery({ origin: 'cliente', valid: true, alreadyDelivered: false, terms: null }))
      .toMatchObject({ classification: 'isento', units: 0, reason: 'sem_condicao_comercial' });
  });
});
