import { afterEach, describe, expect, it, vi } from 'vitest';
import { lerCoresML, lerEstoqueVivoML } from '../leitura-ml.ts';
afterEach(() => vi.unstubAllGlobals());
const resp = (b: unknown, status = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status });

describe('lerCoresML', () => {
  it('uma requisição; cor por item com o VALOR certo; não-200 fica fora', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return resp([
      { status_code: 200, body: { id: 'MLB1', attributes: [{ id: 'COLOR', value_name: 'Azul' }] } },
      { status_code: 200, body: { id: 'MLB3', attributes: [{ id: 'BRAND', value_name: 'X' }] } },
      { status_code: 404 },
    ]); }));
    const m = await lerCoresML('t', ['MLB1', 'MLB2', 'MLB3']);
    expect(urls).toEqual(['https://api.mercadolibre.com/items/bulk?ids=MLB1,MLB2,MLB3&attributes=status_code,body.id,body.attributes']);
    expect(Object.fromEntries(m)).toEqual({ MLB1: 'Azul', MLB3: null });
  });
  it('HTTP de erro → lança (o worker reagenda)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 503)));
    await expect(lerCoresML('t', ['MLB1'])).rejects.toThrow('multiget de cores falhou (503)');
  });
  it('resposta objeto → TypeError, como hoje', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ message: 'x' })));
    await expect(lerCoresML('t', ['MLB1'])).rejects.toThrow(TypeError);
  });
  it('resposta null → mapa vazio, como hoje (json ?? [])', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp('null')));
    expect((await lerCoresML('t', ['MLB1'])).size).toBe(0);
  });
});

describe('lerCoresML — dedup', () => {
  it('id repetido vai uma vez na URL (o bulk responde 400 a repetido)', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return resp([]); }));
    await lerCoresML('t', ['MLB1', 'MLB1']);
    expect(new URL(urls[0]).searchParams.get('ids')).toBe('MLB1');
  });
});

describe('lerEstoqueVivoML', () => {
  it('available_quantity por item; ausente vira 0; HTTP de erro → mapa vazio sem lançar', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(u); return resp([{ status_code: 200, body: { id: 'MLB1', available_quantity: 4 } }, { status_code: 200, body: { id: 'MLB2' } }]); }));
    expect(Object.fromEntries(await lerEstoqueVivoML(async () => 't', ['MLB1', 'MLB2']))).toEqual({ MLB1: 4, MLB2: 0 });
    expect(urls[0]).toBe('https://api.mercadolibre.com/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.available_quantity');
    vi.stubGlobal('fetch', vi.fn(async () => resp({}, 500)));
    expect((await lerEstoqueVivoML(async () => 't', ['MLB1'])).size).toBe(0);
  });
  it('resposta objeto com HTTP 200 → TypeError, como hoje', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => resp({ message: 'x' })));
    await expect(lerEstoqueVivoML(async () => 't', ['MLB1'])).rejects.toThrow(TypeError);
  });
  it('getToken chamado UMA vez, antes do fetch; rejeição de getToken → sem fetch', async () => {
    const ordem: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => { ordem.push('fetch'); return resp([]); }));
    await lerEstoqueVivoML(async () => { ordem.push('token'); return 't'; }, ['MLB1']);
    expect(ordem).toEqual(['token', 'fetch']);
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await expect(lerEstoqueVivoML(() => Promise.reject(new Error('sem token')), ['MLB1'])).rejects.toThrow('sem token');
    expect(f).not.toHaveBeenCalled();
  });
});
