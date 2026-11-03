// GET do enriquecimento: uma tentativa, status preservado, nunca lança.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMlUmaVez } from '../enriquecimento-busca-io.ts';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

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
});
