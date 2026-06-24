import { describe, it, expect } from 'vitest';
import { amountComDesconto, montarFaixasPxQ } from '../atacado';

describe('amountComDesconto', () => {
  it('converte % em valor absoluto arredondado a 2 casas', () => {
    expect(amountComDesconto(12.55, 5)).toBe(11.92);
    expect(amountComDesconto(100, 10)).toBe(90);
  });
});

describe('montarFaixasPxQ', () => {
  it('sem faixas → só a base (preço cheio, sem restrição)', () => {
    const r = montarFaixasPxQ(16.75, []);
    expect(r).toEqual([
      { type: 'standard', amount: 16.75, currency_id: 'BRL', conditions: { context_restrictions: [] } },
    ]);
  });

  it('com faixas → base + faixas B2B ordenadas por min_unidades', () => {
    const r = montarFaixasPxQ(100, [
      { min_unidades: 10, desconto_pct: 8 },
      { min_unidades: 5, desconto_pct: 5 },
    ]);
    expect(r[0]).toEqual({ type: 'standard', amount: 100, currency_id: 'BRL', conditions: { context_restrictions: [] } });
    expect(r[1]).toEqual({
      type: 'standard', amount: 95, currency_id: 'BRL',
      conditions: { context_restrictions: ['channel_marketplace', 'user_type_business'], min_purchase_unit: 5 },
    });
    expect(r[2]).toEqual({
      type: 'standard', amount: 92, currency_id: 'BRL',
      conditions: { context_restrictions: ['channel_marketplace', 'user_type_business'], min_purchase_unit: 10 },
    });
  });
});
