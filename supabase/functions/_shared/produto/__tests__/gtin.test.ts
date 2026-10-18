import { describe, it, expect } from 'vitest';
import { gtinOuNull } from '../gtin.ts';

describe('gtinOuNull', () => {
  it('mantém EAN válido (aparado)', () => expect(gtinOuNull(' 7891234567895 ')).toBe('7891234567895'));
  it('mantém código interno 3000*', () => expect(gtinOuNull('300000278943')).toBe('300000278943'));
  it('descarta quantidade digitada como EAN', () => {
    expect(gtinOuNull('1')).toBeNull();
    expect(gtinOuNull('2')).toBeNull();
  });
  it('descarta dígito verificador errado', () => expect(gtinOuNull('7891234567896')).toBeNull());
  it('descarta não numérico e vazio', () => {
    expect(gtinOuNull('789ABC')).toBeNull();
    expect(gtinOuNull('  ')).toBeNull();
    expect(gtinOuNull(null)).toBeNull();
  });
});
