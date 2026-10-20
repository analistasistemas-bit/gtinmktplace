import { afterEach, describe, expect, it, vi } from 'vitest';
import { lerSalePriceML } from '../sale-price';

const globalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = globalFetch; });

describe('lerSalePriceML', () => {
  it('com promoção: preço "por" em preco e preço "de" em precoRegular', async () => {
    let url = '';
    globalThis.fetch = ((u: string) => {
      url = u;
      return Promise.resolve(new Response(JSON.stringify({
        price_id: '25', amount: 12.69, regular_amount: 14.1, currency_id: 'BRL', metadata: {},
      }), { status: 200 }));
    }) as typeof fetch;
    expect(await lerSalePriceML('tok', 'MLB1')).toEqual({ preco: 12.69, precoRegular: 14.1, moeda: 'BRL' });
    expect(url).toBe('https://api.mercadolibre.com/items/MLB1/sale_price?context=channel_marketplace');
  });

  it('HTTP 500 → null', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response('x', { status: 500 }))) as typeof fetch;
    expect(await lerSalePriceML('tok', 'MLB1')).toBeNull();
  });

  it('a chamada leva o sinal de timeout de 5 s', async () => {
    const sinal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(sinal);
    let recebido: AbortSignal | undefined;
    globalThis.fetch = ((_u: string, init?: RequestInit) => {
      recebido = init?.signal ?? undefined;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as typeof fetch;
    await lerSalePriceML('tok', 'MLB1');
    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(recebido).toBe(sinal);
    timeout.mockRestore();
  });

  it('fetch rejeita (timeout/rede) → null', async () => {
    globalThis.fetch = (() => Promise.reject(new DOMException('timeout', 'TimeoutError'))) as typeof fetch;
    expect(await lerSalePriceML('tok', 'MLB1')).toBeNull();
  });
});
