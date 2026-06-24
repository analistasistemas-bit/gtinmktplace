import { describe, it, expect, vi, afterEach } from 'vitest';
import { amountComDesconto, montarFaixasPxQ, aplicarPxQ } from '../atacado';

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

describe('aplicarPxQ', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lança com status e body do ML quando a resposta não é ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 422, text: async () => 'item not found',
    })) as unknown as typeof fetch);
    await expect(aplicarPxQ('tok', 'MLB1', 10, [])).rejects.toThrow(/422.*item not found/);
  });

  it('não lança quando a resposta é ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '' })) as unknown as typeof fetch);
    await expect(aplicarPxQ('tok', 'MLB1', 10, [{ min_unidades: 5, desconto_pct: 5 }])).resolves.toBeUndefined();
  });
});
