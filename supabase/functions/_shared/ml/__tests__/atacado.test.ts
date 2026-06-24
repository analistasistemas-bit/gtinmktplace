import { describe, it, expect, vi, afterEach } from 'vitest';
import { amountComDesconto, montarFaixasPxQ, aplicarPxQ } from '../atacado';

describe('amountComDesconto', () => {
  it('converte % em valor absoluto arredondado a 2 casas', () => {
    expect(amountComDesconto(12.55, 5)).toBe(11.92);
    expect(amountComDesconto(100, 10)).toBe(90);
  });
});

describe('montarFaixasPxQ', () => {
  it('sem faixas → [] (POST {prices:[]} limpa as faixas no ML)', () => {
    expect(montarFaixasPxQ(16.75, [])).toEqual([]);
  });

  it('só as faixas B2B, ordenadas por min_unidades (sem a base do anúncio)', () => {
    const r = montarFaixasPxQ(100, [
      { min_unidades: 10, desconto_pct: 8 },
      { min_unidades: 5, desconto_pct: 5 },
    ]);
    expect(r).toEqual([
      {
        type: 'standard', amount: 95, currency_id: 'BRL',
        conditions: { context_restrictions: ['channel_marketplace', 'user_type_business'], min_purchase_unit: 5 },
      },
      {
        type: 'standard', amount: 92, currency_id: 'BRL',
        conditions: { context_restrictions: ['channel_marketplace', 'user_type_business'], min_purchase_unit: 10 },
      },
    ]);
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

  it('faz POST em /prices/standard/quantity com { prices: [faixas] }', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    await expect(aplicarPxQ('tok', 'MLB1', 100, [{ min_unidades: 5, desconto_pct: 5 }])).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.mercadolibre.com/items/MLB1/prices/standard/quantity');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      prices: [{
        type: 'standard', amount: 95, currency_id: 'BRL',
        conditions: { context_restrictions: ['channel_marketplace', 'user_type_business'], min_purchase_unit: 5 },
      }],
    });
  });

  it('faixas vazias → POST { prices: [] } (limpa)', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
    await aplicarPxQ('tok', 'MLB1', 100, []);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ prices: [] });
  });
});
