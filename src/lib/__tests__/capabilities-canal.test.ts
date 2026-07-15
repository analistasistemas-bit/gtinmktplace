import { describe, it, expect } from 'vitest';
import { avisosCapabilities } from '@/lib/capabilities-canal';

describe('avisosCapabilities', () => {
  it('avisa títulos acima do limite do canal (ML: 60)', () => {
    const avisos = avisosCapabilities(['a'.repeat(61), 'curto', 'b'.repeat(80)], ['mercado_livre']);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toContain('2 títulos');
    expect(avisos[0]).toContain('60');
    expect(avisos[0]).toContain('Mercado Livre');
  });
  it('concordância no singular (1 título)', () => {
    const avisos = avisosCapabilities(['a'.repeat(61), 'curto'], ['mercado_livre']);
    expect(avisos[0]).toContain('1 título excede');
  });
  it('sem excesso ou canal sem capabilities conhecidas → sem avisos', () => {
    expect(avisosCapabilities(['curto'], ['mercado_livre'])).toEqual([]);
    expect(avisosCapabilities(['x'.repeat(300)], ['shopee'])).toEqual([]); // não inventamos limite
  });
});
