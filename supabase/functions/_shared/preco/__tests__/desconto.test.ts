import { describe, it, expect } from 'vitest';
import { calcularPrecoDe, pctEfetivo } from '../desconto';

describe('calcularPrecoDe', () => {
  it('infla o preço a partir do pct: 12.29 @ 15% → 14.46', () => {
    expect(calcularPrecoDe(12.29, 15)).toBe(14.46);
  });
  it('arredonda para 2 casas: 4.00 @ 15% → 4.71', () => {
    expect(calcularPrecoDe(4, 15)).toBe(4.71);
  });
  it('pct 0 → null (sem selo)', () => {
    expect(calcularPrecoDe(12.29, 0)).toBeNull();
  });
  it('pct >= 100 → null', () => {
    expect(calcularPrecoDe(12.29, 100)).toBeNull();
  });
  it('preço <= 0 → null', () => {
    expect(calcularPrecoDe(0, 15)).toBeNull();
  });
});

describe('pctEfetivo', () => {
  it('usa o override da família quando presente', () => {
    expect(pctEfetivo(20, 15)).toBe(20);
  });
  it('cai no global quando o override é null', () => {
    expect(pctEfetivo(null, 15)).toBe(15);
  });
});
