// redisEvalInteiro (acesso de agentes, ADR-0210): EVAL com resposta inteira obrigatória — quem chama é fail-closed.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redisEvalInteiro } from '../client.ts';

const fetchMock = vi.fn();
const responder = (result: unknown) =>
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ result }), { status: 200 }));
const corpo = (i = 0) => JSON.parse(fetchMock.mock.calls[i][1].body as string);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'UPSTASH_REDIS_REST_URL' ? 'https://r.test' : 'tok') } });
});

describe('redisEvalInteiro', () => {
  it('envia EVAL script numkeys chaves args e devolve o inteiro (inclusive negativo)', async () => {
    responder(7);
    await expect(redisEvalInteiro('return 7', ['k1', 'k2'], [5, 'x'])).resolves.toBe(7);
    expect(corpo()).toEqual(['EVAL', 'return 7', 2, 'k1', 'k2', 5, 'x']);
    responder(-1);
    await expect(redisEvalInteiro('return -1', ['k'], [])).resolves.toBe(-1);
  });

  it.each([null, 'abc', '3', 1.5, {}])('rejeita resposta não inteira %j', async (r) => {
    responder(r);
    await expect(redisEvalInteiro('s', ['k'], [1])).rejects.toThrow();
  });

  it('propaga erro HTTP e erro do Redis; repassa o sinal', async () => {
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 500 }));
    await expect(redisEvalInteiro('s', ['k'], [])).rejects.toThrow();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'NOSCRIPT' }), { status: 200 }));
    await expect(redisEvalInteiro('s', ['k'], [])).rejects.toThrow();
    const s = new AbortController().signal;
    responder(1);
    await redisEvalInteiro('s', ['k'], [], s);
    expect(fetchMock.mock.calls[2][1].signal).toBe(s);
  });
});
