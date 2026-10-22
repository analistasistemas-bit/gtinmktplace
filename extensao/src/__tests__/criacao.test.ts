import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dataCriacaoDoAnuncio } from '../criacao';
import { instalarChromeFalso } from './chrome-falso';

const fetchFalso = vi.fn();
beforeEach(() => { instalarChromeFalso(); vi.stubGlobal('fetch', fetchFalso); fetchFalso.mockReset(); });

describe('dataCriacaoDoAnuncio', () => {
  it('Codex: duas análises simultâneas do mesmo anúncio fazem um GET só', async () => {
    fetchFalso.mockImplementation(async () => new Response('"gtm_event":{"itemId":"MLB5","startTime":"2026-01-01T00:00:00Z"}'));
    const [a, b] = await Promise.all([dataCriacaoDoAnuncio('MLB5'), dataCriacaoDoAnuncio('MLB5')]);
    expect([a, b]).toEqual(['2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z']);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('falha (rede) → null, guardada: não tenta de novo', async () => {
    fetchFalso.mockRejectedValue(new Error('rede'));
    expect(await dataCriacaoDoAnuncio('MLB6')).toBeNull();
    expect(await dataCriacaoDoAnuncio('MLB6')).toBeNull();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});
