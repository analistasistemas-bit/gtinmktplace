// Helpers de contador e MGET (fatia 2 da extensão, regra 9): contadores rejeitam resposta nula/inválida
// porque o orçamento global do ML é fail-closed — nada de `?? 0`.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redisDecrBy, redisExpire, redisIncrBy, redisMget } from '../client.ts';

const fetchMock = vi.fn();
const responder = (result: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ result }), { status: 200 }));
const corpo = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body as string);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'UPSTASH_REDIS_REST_URL' ? 'https://r.test' : 'tok') } });
});

describe('redisIncrBy / redisDecrBy', () => {
  it('envia INCRBY/DECRBY com a quantidade e devolve o inteiro', async () => {
    responder(7);
    await expect(redisIncrBy('k', 5)).resolves.toBe(7);
    expect(corpo()).toEqual(['INCRBY', 'k', 5]);
    responder(2);
    await expect(redisDecrBy('k', 5)).resolves.toBe(2);
    expect(corpo(1)).toEqual(['DECRBY', 'k', 5]);
  });

  it.each([null, 'abc', '3', 1.5, {}])('rejeita resposta inválida %j', async (r) => {
    responder(r);
    await expect(redisIncrBy('k', 1)).rejects.toThrow();
    responder(r);
    await expect(redisDecrBy('k', 1)).rejects.toThrow();
  });

  it('propaga erro HTTP e erro do Redis', async () => {
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 500 }));
    await expect(redisIncrBy('k', 1)).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'WRONGTYPE' }), { status: 200 }));
    await expect(redisIncrBy('k', 1)).rejects.toThrow();
  });
});

describe('redisExpire', () => {
  it('envia EXPIRE e aceita 1/0', async () => {
    responder(1);
    await expect(redisExpire('k', 120)).resolves.toBe(true);
    expect(corpo()).toEqual(['EXPIRE', 'k', 120]);
    responder(0);
    await expect(redisExpire('k', 120)).resolves.toBe(false);
  });

  it('rejeita resposta inválida', async () => {
    responder(null);
    await expect(redisExpire('k', 120)).rejects.toThrow();
  });
});

describe('redisMget', () => {
  it('um único MGET, ordem preservada, miss = null', async () => {
    responder(['a', null, 'c']);
    await expect(redisMget(['k1', 'k2', 'k3'])).resolves.toEqual(['a', null, 'c']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(corpo()).toEqual(['MGET', 'k1', 'k2', 'k3']);
  });

  it('lista vazia não gasta comando', async () => {
    await expect(redisMget([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, 'x', ['a'], ['a', 1]])('rejeita resposta inválida %j', async (r) => {
    responder(r);
    await expect(redisMget(['k1', 'k2'])).rejects.toThrow();
  });
});

describe('sinal opcional (prazo da página da extensão)', () => {
  it('repassa o sinal ao fetch; sem sinal, igual a antes', async () => {
    const s = new AbortController().signal;
    responder(1); await redisIncrBy('k', 1, s);
    responder(1); await redisDecrBy('k', 1, s);
    responder(1); await redisExpire('k', 9, s);
    responder(['a']); await redisMget(['k'], s);
    responder(1); await redisIncrBy('k', 1);
    expect(fetchMock.mock.calls.map((c) => c[1].signal)).toEqual([s, s, s, s, undefined]);
  });

  it('abortado → lança (resultado incerto para o chamador)', async () => {
    fetchMock.mockImplementationOnce((_u: string, init: RequestInit) => new Promise((_ok, ko) => {
      init.signal!.addEventListener('abort', () => ko(new DOMException('a', 'AbortError')));
    }));
    const ctl = new AbortController();
    const p = redisMget(['k'], ctl.signal);
    ctl.abort();
    await expect(p).rejects.toThrow();
  });
});
