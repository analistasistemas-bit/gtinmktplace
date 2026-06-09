import { describe, it, expect } from 'vitest';
import { arredondar5Proximo, arredondar5Cima } from '../arredondar';

describe('arredondar5Proximo (múltiplo de R$ 0,05 mais próximo)', () => {
  it('28,56 → 28,55', () => { expect(arredondar5Proximo(28.56)).toBeCloseTo(28.55, 2); });
  it('28,58 → 28,60', () => { expect(arredondar5Proximo(28.58)).toBeCloseTo(28.6, 2); });
  it('já múltiplo permanece (28,50)', () => { expect(arredondar5Proximo(28.5)).toBeCloseTo(28.5, 2); });
  it('11,40 permanece', () => { expect(arredondar5Proximo(11.4)).toBeCloseTo(11.4, 2); });
});

describe('arredondar5Cima (menor múltiplo de R$ 0,05 ≥ valor)', () => {
  it('23,01 → 23,05', () => { expect(arredondar5Cima(23.01)).toBeCloseTo(23.05, 2); });
  it('já múltiplo permanece (23,00)', () => { expect(arredondar5Cima(23)).toBeCloseTo(23, 2); });
  it('20,001 → 20,05 (nunca abaixo do piso)', () => { expect(arredondar5Cima(20.001)).toBeCloseTo(20.05, 2); });
});
