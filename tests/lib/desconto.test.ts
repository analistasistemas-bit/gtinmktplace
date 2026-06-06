import { describe, it, expect } from 'vitest';
import { calcularPrecoDe, pctEfetivo } from '@/lib/desconto';

describe('calcularPrecoDe (front)', () => {
  it('12.29 @ 15% → 14.46', () => expect(calcularPrecoDe(12.29, 15)).toBe(14.46));
  it('pct 0 → null', () => expect(calcularPrecoDe(12.29, 0)).toBeNull());
  it('pct 100 → null', () => expect(calcularPrecoDe(1, 100)).toBeNull());
});
describe('pctEfetivo (front)', () => {
  it('override', () => expect(pctEfetivo(20, 15)).toBe(20));
  it('global', () => expect(pctEfetivo(null, 15)).toBe(15));
});
