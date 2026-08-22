import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apifyConfigurado, buscarAnunciosML } from '../client.ts';

const LIMITS_URL = 'https://api.apify.com/v2/users/me/limits';

const respLimits = (limite: number, uso: number) =>
  new Response(
    JSON.stringify({
      data: { limits: { maxMonthlyUsageUsd: limite }, current: { monthlyUsageUsd: uso } },
    }),
    { status: 200 },
  );

const respItens = (itens: unknown[]) => new Response(JSON.stringify(itens), { status: 200 });

const tokenDaChamada = (init?: RequestInit) =>
  (init?.headers as Record<string, string>)?.Authorization;

let env: Record<string, string> = {};

beforeEach(() => {
  env = {};
  (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => env[k] } };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apifyConfigurado', () => {
  it('false sem nenhum token', () => {
    expect(apifyConfigurado()).toBe(false);
  });
  it('true com só o token principal', () => {
    env.APIFY_TOKEN = 'tok1';
    expect(apifyConfigurado()).toBe(true);
  });
  it('true com só um token de fallback', () => {
    env.APIFY_TOKEN_3 = 'tok3';
    expect(apifyConfigurado()).toBe(true);
  });
});

describe('buscarAnunciosML — sem token', () => {
  it('retorna null sem chamar fetch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    expect(await buscarAnunciosML('termo')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('buscarAnunciosML — saldo e ordem de prioridade', () => {
  beforeEach(() => {
    env.APIFY_TOKEN = 'tok1';
    env.APIFY_TOKEN_2 = 'tok2';
  });

  it('usa o token 1 quando o saldo dele é suficiente', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url) === LIMITS_URL) {
        expect(tokenDaChamada(init)).toBe('Bearer tok1');
        return respLimits(1, 0.5); // sobram 0.5 >= 0.15
      }
      expect(tokenDaChamada(init)).toBe('Bearer tok1');
      return respItens([{ ok: true }]);
    });
    expect(await buscarAnunciosML('termo')).toEqual([{ ok: true }]);
  });

  it('pula pro token 2 quando o saldo do token 1 está no final (<0.15)', async () => {
    const chamadas: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const token = tokenDaChamada(init);
      chamadas.push(`${String(url).includes('limits') ? 'limits' : 'run'}:${token}`);
      if (String(url) === LIMITS_URL) {
        return token === 'Bearer tok1' ? respLimits(1, 0.9) : respLimits(1, 0.5);
      }
      return respItens([{ de: 'tok2' }]);
    });
    expect(await buscarAnunciosML('termo')).toEqual([{ de: 'tok2' }]);
    expect(chamadas).toEqual(['limits:Bearer tok1', 'limits:Bearer tok2', 'run:Bearer tok2']);
  });

  it('checagem de saldo falhando (erro de rede) não bloqueia — tenta o token mesmo assim', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url) === LIMITS_URL) throw new Error('timeout');
      return respItens([{ ok: true }]);
    });
    expect(await buscarAnunciosML('termo')).toEqual([{ ok: true }]);
  });

  it('todos os tokens com saldo baixo → null, sem tentar rodar o scraping', async () => {
    const rodouScraping = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url) === LIMITS_URL) return respLimits(1, 0.9); // sobra 0.10 < 0.15
      rodouScraping();
      return respItens([]);
    });
    expect(await buscarAnunciosML('termo')).toBeNull();
    expect(rodouScraping).not.toHaveBeenCalled();
  });
});

describe('buscarAnunciosML — fallback reativo em erro de cota', () => {
  beforeEach(() => {
    env.APIFY_TOKEN = 'tok1';
    env.APIFY_TOKEN_2 = 'tok2';
  });

  it('402 (cota estourada) no token 1 → tenta o token 2 e devolve o resultado dele', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url) === LIMITS_URL) return respLimits(1, 0.5);
      const token = tokenDaChamada(init);
      if (token === 'Bearer tok1') return new Response('sem saldo', { status: 402 });
      return respItens([{ de: 'tok2' }]);
    });
    expect(await buscarAnunciosML('termo')).toEqual([{ de: 'tok2' }]);
  });

  it('erro que não é de cota nem de auth (500) → desiste, não tenta o token 2', async () => {
    const chamouRunComToken2 = vi.fn();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url) === LIMITS_URL) return respLimits(1, 0.5);
      const token = tokenDaChamada(init);
      if (token === 'Bearer tok1') return new Response('erro interno', { status: 500 });
      chamouRunComToken2();
      return respItens([]);
    });
    expect(await buscarAnunciosML('termo')).toBeNull();
    expect(chamouRunComToken2).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    '%d (token inválido/revogado) no token 1 → tenta o token 2, com warning',
    async (status) => {
      const warnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
        if (String(url) === LIMITS_URL) return respLimits(1, 0.5);
        const token = tokenDaChamada(init);
        if (token === 'Bearer tok1') return new Response('token inválido', { status });
        return respItens([{ de: 'tok2' }]);
      });
      expect(await buscarAnunciosML('termo')).toEqual([{ de: 'tok2' }]);
      expect(warnMock).toHaveBeenCalledWith(expect.stringContaining(String(status)));
    },
  );
});
