// GET do enriquecimento: uma tentativa, status preservado, nunca lança.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMlUmaVez, retryAfterMs } from '../enriquecimento-busca-io.ts';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const pendurado = () => (_u: string, init: RequestInit) => new Promise((_ok, ko) => {
  init.signal!.addEventListener('abort', () => ko(new DOMException('abort', 'AbortError')));
});

describe('getMlUmaVez', () => {
  it('200: corpo JSON, token no header e timeout', async () => {
    fetchMock.mockResolvedValue(new Response('{"a":1}', { status: 200 }));
    expect(await getMlUmaVez('https://ml/x', 'tok')).toEqual({ status: 200, corpo: { a: 1 } });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('404 mantém o corpo ("No winners found")', async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"No winners found"}', { status: 404 }));
    expect(await getMlUmaVez('https://ml/x', 'tok')).toEqual({ status: 404, corpo: { message: 'No winners found' } });
  });

  it('429 com corpo não-JSON: uma tentativa só', async () => {
    fetchMock.mockResolvedValue(new Response('local_rate_limited', { status: 429 }));
    expect(await getMlUmaVez('https://ml/x', 'tok')).toEqual({ status: 429, corpo: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('timeout/rede → status 0, sem retry', async () => {
    fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
    expect(await getMlUmaVez('https://ml/x', 'tok', 10)).toEqual({ status: 0, corpo: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancelamento da página aborta o GET em voo → status 0, sem retry', async () => {
    fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_ok, ko) => {
      init.signal!.addEventListener('abort', () => ko(new DOMException('abort', 'AbortError')));
    }));
    const ctl = new AbortController();
    const p = getMlUmaVez('https://ml/x', 'tok', 3000, ctl.signal);
    ctl.abort();
    expect(await p).toEqual({ status: 0, corpo: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('timeout curto (restante da página) também aborta', async () => {
    fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_ok, ko) => {
      init.signal!.addEventListener('abort', () => ko(new DOMException('timeout', 'TimeoutError')));
    }));
    expect(await getMlUmaVez('https://ml/x', 'tok', 5, new AbortController().signal)).toEqual({ status: 0, corpo: null });
  });

  it('Retry-After em segundos no 429 → tentarApos (ms)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-03T14:05:30.000Z'));
    fetchMock.mockResolvedValue(new Response('x', { status: 429, headers: { 'Retry-After': '30' } }));
    expect(await getMlUmaVez('https://ml/x', 'tok')).toEqual({ status: 429, corpo: null, tentarApos: Date.parse('2026-11-03T14:06:00.000Z') });
  });

  it('Retry-After em data HTTP no 429 → tentarApos (ms); fora do 429 é ignorado', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 429, headers: { 'Retry-After': 'Tue, 03 Nov 2026 14:07:00 GMT' } }));
    expect(await getMlUmaVez('https://ml/x', 'tok')).toEqual({ status: 429, corpo: null, tentarApos: Date.parse('2026-11-03T14:07:00.000Z') });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200, headers: { 'Retry-After': '30' } }));
    expect(await getMlUmaVez('https://ml/x', 'tok')).toEqual({ status: 200, corpo: {} });
  });

  it('retryAfterMs: inválido/ausente = undefined', () => {
    expect(retryAfterMs(null, 0)).toBeUndefined();
    expect(retryAfterMs('daqui a pouco', 0)).toBeUndefined();
    expect(retryAfterMs(' 2 ', 1000)).toBe(3000);
  });

  it('sem AbortSignal.any no runtime: o cancelamento ainda aborta o GET em voo e o listener é removido', async () => {
    vi.stubGlobal('AbortSignal', Object.assign(Object.create(AbortSignal), { any: undefined, timeout: AbortSignal.timeout }));
    fetchMock.mockImplementation(pendurado());
    const ctl = new AbortController();
    const remover = vi.spyOn(ctl.signal, 'removeEventListener');
    const p = getMlUmaVez('https://ml/x', 'tok', 3000, ctl.signal);
    ctl.abort();
    expect(await p).toEqual({ status: 0, corpo: null });
    expect(remover).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('GET concluído desarma o timer e remove o listener do cancelamento', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    const ctl = new AbortController();
    const remover = vi.spyOn(ctl.signal, 'removeEventListener');
    const limpar = vi.spyOn(globalThis, 'clearTimeout');
    await getMlUmaVez('https://ml/x', 'tok', 3000, ctl.signal);
    expect(remover).toHaveBeenCalledTimes(1);
    expect(limpar).toHaveBeenCalled();
  });
});
