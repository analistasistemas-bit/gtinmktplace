import { beforeEach, describe, expect, it, vi } from 'vitest';
import { observadoDoAnuncio } from '../criacao';
import { instalarChromeFalso } from './chrome-falso';

const fetchFalso = vi.fn();
beforeEach(() => { instalarChromeFalso(); vi.stubGlobal('fetch', fetchFalso); fetchFalso.mockReset(); });

describe('dataCriacaoDoAnuncio', () => {
  it('Codex: duas análises simultâneas do mesmo anúncio fazem um GET só', async () => {
    fetchFalso.mockImplementation(async () => new Response('"subtitle_label":{"text":"Novo | +25 vendidos"} "gtm_event":{"itemId":"MLB5","startTime":"2026-01-01T00:00:00Z"}'));
    const [a, b] = await Promise.all([observadoDoAnuncio('MLB5'), observadoDoAnuncio('MLB5')]);
    const esperado = { criadoEm: '2026-01-01T00:00:00Z', vendidosAnuncio: '+25 vendidos' };
    expect([a, b]).toEqual([esperado, esperado]);
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });

  it('falha (rede) → null, guardada: não tenta de novo', async () => {
    fetchFalso.mockRejectedValue(new Error('rede'));
    expect(await observadoDoAnuncio('MLB6')).toEqual({ criadoEm: null, vendidosAnuncio: null });
    expect(await observadoDoAnuncio('MLB6')).toEqual({ criadoEm: null, vendidosAnuncio: null });
    expect(fetchFalso).toHaveBeenCalledTimes(1);
  });
});
