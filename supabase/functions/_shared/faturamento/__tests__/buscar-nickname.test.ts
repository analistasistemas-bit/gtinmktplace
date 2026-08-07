import { describe, it, expect, vi, afterEach } from 'vitest';
import { buscarNickname } from '../perguntas-io.ts';

// `nicksCache` vive no escopo do MÓDULO — ou seja, por isolate, não por invocação. Cada caso usa
// um userId próprio para não herdar o cache do anterior (é exatamente o comportamento sob teste).
// Achado M1 do code-review-v7: cachear a FALHA fixa "sem nickname" até o isolate reciclar, e o
// retry nunca recupera.

function mockFetch(...respostas: Array<{ ok: boolean; nickname?: string } | Error>) {
  const fn = vi.fn(async () => {
    const r = respostas.shift();
    if (r instanceof Error) throw r;
    if (!r) throw new Error('fetch chamado mais vezes que o esperado');
    return { ok: r.ok, json: async () => ({ nickname: r.nickname }) } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('buscarNickname — cache não pode guardar falha (ADR-0109/v7)', () => {
  it('resposta ok: devolve o nick e cacheia (2ª chamada não refaz o fetch)', async () => {
    const f = mockFetch({ ok: true, nickname: 'COMPRADOR1' });
    expect(await buscarNickname('tok', 1001)).toBe('COMPRADOR1');
    expect(await buscarNickname('tok', 1001)).toBe('COMPRADOR1');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('erro de rede NÃO é cacheado: a 2ª chamada tenta de novo e recupera o nick', async () => {
    const f = mockFetch(new Error('rede caiu'), { ok: true, nickname: 'COMPRADOR2' });
    expect(await buscarNickname('tok', 1002)).toBeNull();
    expect(await buscarNickname('tok', 1002)).toBe('COMPRADOR2');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('resposta não-ok NÃO é cacheada: a 2ª chamada tenta de novo', async () => {
    const f = mockFetch({ ok: false }, { ok: true, nickname: 'COMPRADOR3' });
    expect(await buscarNickname('tok', 1003)).toBeNull();
    expect(await buscarNickname('tok', 1003)).toBe('COMPRADOR3');
    expect(f).toHaveBeenCalledTimes(2);
  });

  // Resposta boa com nickname ausente é informação, não falha: cachear evita repetir a chamada.
  it('usuário sem nickname (resposta ok) É cacheado como null', async () => {
    const f = mockFetch({ ok: true, nickname: undefined });
    expect(await buscarNickname('tok', 1004)).toBeNull();
    expect(await buscarNickname('tok', 1004)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
