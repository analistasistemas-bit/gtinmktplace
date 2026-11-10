import { describe, it, expect, afterEach, vi } from 'vitest';
import { atualizarFotosItemML, buscarItemML, excluirItemML } from '../atualizar-item';

// Galeria da cor (Task 13): PUT só de fotos, corpo medido no ensaio da Task 1.
describe('atualizarFotosItemML', () => {
  const capturar = (status = 200) => {
    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    const f = vi.fn(async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return new Response('{}', { status }); });
    return { chamadas, f: f as unknown as typeof fetch };
  };

  it('Legacy: pictures + variations {id, picture_ids}; campos extras (price/status/available_quantity) nunca saem', async () => {
    const { chamadas, f } = capturar();
    const corpo = {
      pictures: [{ id: 'A', price: 1 }], status: 'paused', price: 10, available_quantity: 3,
      variations: [{ id: 11, picture_ids: ['A'], available_quantity: 5, price: 9 }],
    };
    await atualizarFotosItemML('tok', 'MLB1', corpo as never, f);
    expect(chamadas[0].url).toBe('https://api.mercadolibre.com/items/MLB1');
    expect(chamadas[0].init.method).toBe('PUT');
    expect(chamadas[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(chamadas[0].init.body as string)).toEqual({ pictures: [{ id: 'A' }], variations: [{ id: 11, picture_ids: ['A'] }] });
  });

  it('UP plano: só { pictures }', async () => {
    const { chamadas, f } = capturar();
    await atualizarFotosItemML('tok', 'MLB2', { pictures: [{ id: 'A' }, { id: 'B' }] }, f);
    expect(JSON.parse(chamadas[0].init.body as string)).toEqual({ pictures: [{ id: 'A' }, { id: 'B' }] });
  });

  it('HTTP de erro lança com status (5xx = incerto para a saga)', async () => {
    const { f } = capturar(502);
    await expect(atualizarFotosItemML('tok', 'MLB1', { pictures: [{ id: 'A' }] }, f)).rejects.toMatchObject({ status: 502 });
  });

  it('fetch que rejeita (timeout/rede) → erro sem .status (incerto para a saga)', async () => {
    const f = vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); }) as unknown as typeof fetch;
    const erro = await atualizarFotosItemML('tok', 'MLB1', { pictures: [{ id: 'A' }] }, f).catch((e) => e);
    expect(erro).toBeInstanceOf(DOMException);
    expect((erro as { status?: number }).status).toBeUndefined();
  });
});

const globalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = globalFetch; });

describe('buscarItemML', () => {
  it('extrai price por variacao', async () => {
    const fakeFetch = () => Promise.resolve(new Response(JSON.stringify({
      id: 'MLB1',
      variations: [{ id: 9, seller_custom_field: 'A1', available_quantity: 3, price: 42.5, picture_ids: [] }],
      pictures: [],
    }), { status: 200 }));
    globalThis.fetch = fakeFetch as typeof fetch;
    const item = await buscarItemML('tok', 'MLB1');
    expect(item.variations[0].price).toBe(42.5);
  });

  it('extrai sold_quantity', async () => {
    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({
      id: 'MLB1', sold_quantity: 5, variations: [], pictures: [],
    }), { status: 200 }))) as typeof fetch;
    const item = await buscarItemML('tok', 'MLB1');
    expect(item.soldQuantity).toBe(5);
  });
});

describe('excluirItemML', () => {
  afterEach(() => { globalThis.fetch = globalFetch; vi.restoreAllMocks(); });

  it('closed + deleted + confirma 404', async () => {
    let gets = 0;
    globalThis.fetch = vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PUT') return new Response('{}', { status: 200 });
      gets++;
      if (gets <= 1) {
        return new Response(JSON.stringify({
          id: 'MLB1', status: 'active', sub_status: [], sold_quantity: 0, variations: [], pictures: [],
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    await excluirItemML('tok', 'MLB1');
    expect(gets).toBeGreaterThan(1);
  });
});
