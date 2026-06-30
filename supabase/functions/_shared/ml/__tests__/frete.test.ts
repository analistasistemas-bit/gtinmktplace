import { describe, it, expect } from 'vitest';
import { freteSeVendedorPaga } from '../frete';

// Casos reais confirmados em produção (cat MLB270273, conta AVILBV, 2026-06-30).
describe('freteSeVendedorPaga', () => {
  it('comprador paga abaixo do limite: free_shipping_by_meli ausente → 0', () => {
    expect(freteSeVendedorPaga({ list_cost: 5.65, discount: { type: 'none' } })).toBe(0);
  });

  it('faixa incentivada (R$19–78): free_shipping_by_meli true → list_cost', () => {
    expect(freteSeVendedorPaga({ list_cost: 6.55, free_shipping_by_meli: true, discount: { type: 'none' } })).toBe(6.55);
  });

  it('limite nacional (≥ R$79): discount.type mandatory → list_cost', () => {
    expect(freteSeVendedorPaga({ list_cost: 12.35, discount: { type: 'mandatory' } })).toBe(12.35);
  });

  it('coverage ausente → 0', () => {
    expect(freteSeVendedorPaga(undefined)).toBe(0);
  });

  it('vendedor paga mas list_cost ausente → 0 (não NaN)', () => {
    expect(freteSeVendedorPaga({ free_shipping_by_meli: true })).toBe(0);
  });
});
