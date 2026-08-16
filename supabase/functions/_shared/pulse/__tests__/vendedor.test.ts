import { describe, it, expect } from 'vitest';
import { deveGravarVendedor } from '../vendedor.ts';

describe('deveGravarVendedor', () => {
  it('sem linha anterior (1ª vez) → true', () => {
    expect(deveGravarVendedor(null, 20500)).toBe(true);
  });

  it('transactions_total mudou → true', () => {
    expect(deveGravarVendedor({ transactions_total: 20500 }, 20510)).toBe(true);
  });

  it('transactions_total igual → false', () => {
    expect(deveGravarVendedor({ transactions_total: 20500 }, 20500)).toBe(false);
  });
});
