import { describe, it, expect } from 'vitest';
import { calcularMarkup } from '@/lib/markup';

describe('calcularMarkup', () => {
  it('lucro e markup positivos', () => {
    const r = calcularMarkup(4.3, 1.88);
    expect(r.lucro).toBeCloseTo(2.42, 2);
    expect(r.markup).toBeCloseTo(2.42 / 1.88, 4);
  });

  it('líquido abaixo do custo → lucro e markup negativos (prejuízo)', () => {
    const r = calcularMarkup(1.13, 1.88);
    expect(r.lucro).toBeCloseTo(-0.75, 2);
    expect(r.markup).toBeLessThan(0);
  });

  it('custo zero → markup 0 (evita divisão por zero)', () => {
    const r = calcularMarkup(5, 0);
    expect(r.lucro).toBe(5);
    expect(r.markup).toBe(0);
  });
});
