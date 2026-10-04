import { afterEach, describe, expect, it, vi } from 'vitest';
import { lerCoresML, lerEstoqueVivoML } from '../leitura-ml.ts';
afterEach(() => vi.unstubAllGlobals());
const resp = (b: unknown, status = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status });

/** fetch espião que registra a ordem (token/fetch), a URL e o header de autorização. */
function espiao(resposta: () => Response) {
  const ordem: string[] = [];
  const chamadas: Array<{ url: string; auth: string | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => {
    ordem.push('fetch');
    chamadas.push({ url: u, auth: new Headers(init?.headers).get('Authorization') });
    return resposta();
  }));
  const getToken = vi.fn(async () => { ordem.push('token'); return 'tok'; });
  return { ordem, chamadas, getToken };
}
const ids25 = Array.from({ length: 25 }, (_, i) => `MLB${i}`);

describe('lerCoresML', () => {
  it('lista vazia → nenhum token e nenhum fetch', async () => {
    const e = espiao(() => resp([]));
    expect((await lerCoresML(e.getToken, [])).size).toBe(0);
    expect(e.ordem).toEqual([]);
  });
  it('token → fetch, UMA requisição com URL completa (bulk) e Bearer; cor com o VALOR certo; 404 fora', async () => {
    const e = espiao(() => resp([
      { status_code: 200, body: { id: 'MLB1', attributes: [{ id: 'COLOR', value_name: 'Azul' }] } },
      { status_code: 404 },
      { status_code: 200, body: { id: 'MLB3', attributes: [{ id: 'BRAND', value_name: 'X' }] } },
    ]));
    const m = await lerCoresML(e.getToken, ['MLB1', 'MLB2', 'MLB3']);
    expect(e.ordem).toEqual(['token', 'fetch']);
    expect(e.chamadas).toEqual([{ url: 'https://api.mercadolibre.com/items/bulk?ids=MLB1,MLB2,MLB3&attributes=status_code,body.id,body.attributes', auth: 'Bearer tok' }]);
    expect(Object.fromEntries(m)).toEqual({ MLB1: 'Azul', MLB3: null });
  });
  it('mais de 20 ids → continua UMA requisição (sem blocos novos; o ML responde 400, como hoje)', async () => {
    const e = espiao(() => resp({}, 400));
    await expect(lerCoresML(e.getToken, ids25)).rejects.toThrow('multiget de cores falhou (400)');
    expect(e.chamadas).toHaveLength(1);
    expect(new URL(e.chamadas[0].url).searchParams.get('ids')!.split(',')).toEqual(ids25);
  });
  it('id repetido vai uma vez na URL (o bulk responde 400 a repetido)', async () => {
    const e = espiao(() => resp([]));
    await lerCoresML(e.getToken, ['MLB1', 'MLB1']);
    expect(new URL(e.chamadas[0].url).searchParams.get('ids')).toBe('MLB1');
  });
  it('getToken rejeita → sem fetch, erro propagado', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await expect(lerCoresML(() => Promise.reject(new Error('sem token')), ['MLB1'])).rejects.toThrow('sem token');
    expect(f).not.toHaveBeenCalled();
  });
  it('HTTP de erro → lança (o worker reagenda)', async () => {
    const e = espiao(() => resp({}, 503));
    await expect(lerCoresML(e.getToken, ['MLB1'])).rejects.toThrow('multiget de cores falhou (503)');
  });
  it('resposta objeto → TypeError, como hoje (transitório, reagenda)', async () => {
    const e = espiao(() => resp({ message: 'x' }));
    await expect(lerCoresML(e.getToken, ['MLB1'])).rejects.toThrow(TypeError);
  });
  it('resposta null → mapa vazio, como hoje (json ?? [])', async () => {
    const e = espiao(() => resp('null'));
    expect((await lerCoresML(e.getToken, ['MLB1'])).size).toBe(0);
  });
  it('entrada não-200, sem body ou sem id fica fora', async () => {
    const e = espiao(() => resp([
      { status_code: 500, body: { id: 'MLB1' } }, { status_code: 200 }, { status_code: 200, body: { attributes: [] } },
      { status_code: 200, body: { id: 'MLB4', attributes: [{ id: 'COLOR', value_name: 'Rosa' }] } },
    ]));
    expect(Object.fromEntries(await lerCoresML(e.getToken, ['MLB1', 'MLB2', 'MLB3', 'MLB4']))).toEqual({ MLB4: 'Rosa' });
  });
});

describe('lerEstoqueVivoML', () => {
  it('lista vazia → nenhum token e nenhum fetch', async () => {
    const e = espiao(() => resp([]));
    expect((await lerEstoqueVivoML(e.getToken, [])).size).toBe(0);
    expect(e.ordem).toEqual([]);
  });
  it('token → fetch, URL completa e Bearer; available_quantity por item, ausente vira 0', async () => {
    const e = espiao(() => resp([{ status_code: 200, body: { id: 'MLB1', available_quantity: 4 } }, { status_code: 200, body: { id: 'MLB2' } }]));
    expect(Object.fromEntries(await lerEstoqueVivoML(e.getToken, ['MLB1', 'MLB2']))).toEqual({ MLB1: 4, MLB2: 0 });
    expect(e.ordem).toEqual(['token', 'fetch']);
    expect(e.chamadas).toEqual([{ url: 'https://api.mercadolibre.com/items/bulk?ids=MLB1,MLB2&attributes=status_code,body.id,body.available_quantity', auth: 'Bearer tok' }]);
  });
  it('mais de 20 ids → UMA requisição; HTTP de erro → mapa vazio sem lançar', async () => {
    const e = espiao(() => resp({}, 400));
    expect((await lerEstoqueVivoML(e.getToken, ids25)).size).toBe(0);
    expect(e.chamadas).toHaveLength(1);
  });
  it('getToken rejeita → sem fetch, erro propagado', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await expect(lerEstoqueVivoML(() => Promise.reject(new Error('sem token')), ['MLB1'])).rejects.toThrow('sem token');
    expect(f).not.toHaveBeenCalled();
  });
  it('resposta objeto com HTTP 200 → TypeError, como hoje', async () => {
    const e = espiao(() => resp({ message: 'x' }));
    await expect(lerEstoqueVivoML(e.getToken, ['MLB1'])).rejects.toThrow(TypeError);
  });
  it('resposta null → mapa vazio', async () => {
    const e = espiao(() => resp('null'));
    expect((await lerEstoqueVivoML(e.getToken, ['MLB1'])).size).toBe(0);
  });
  it('entrada não-200, sem body ou sem id fica fora', async () => {
    const e = espiao(() => resp([
      { status_code: 404 }, { status_code: 200 }, { status_code: 200, body: { available_quantity: 9 } },
      { status_code: 200, body: { id: 'MLB4', available_quantity: 2 } },
    ]));
    expect(Object.fromEntries(await lerEstoqueVivoML(e.getToken, ['MLB1', 'MLB2', 'MLB3', 'MLB4']))).toEqual({ MLB4: 2 });
  });
});
