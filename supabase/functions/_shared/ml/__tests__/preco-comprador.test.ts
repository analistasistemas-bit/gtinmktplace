import { describe, expect, it, vi } from 'vitest';
import { criarLeitorPreco, parsePrecoComprador } from '../preco-comprador.ts';

const LIDO = '2026-11-25T20:55:32.000Z';
// Respostas reais (2026-11-25), só os campos usados.
const relampago = {
  price_id: '4', amount: 36.09, regular_amount: 42.75, currency_id: 'BRL',
  metadata: { campaign_id: 'C-1', promotion_id: 'OFFER-1', promotion_type: 'lightning' },
};
const semPromo = { price_id: '1', amount: 42.75, regular_amount: null, currency_id: 'BRL', metadata: {} };
const prices = {
  prices: [
    { id: '1', type: 'standard', amount: 42.75, conditions: { start_time: null, end_time: null } },
    { id: '3', type: 'promotion', amount: 37.19, conditions: { end_time: '2026-12-01T03:00:00Z' } },
    { id: '4', type: 'promotion', amount: 36.09, conditions: { end_time: '2026-11-26T03:00:00Z' } },
  ],
};
const resp = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

describe('parsePrecoComprador', () => {
  it('Relâmpago: preço do comprador, tabela e tipo', () => {
    expect(parsePrecoComprador(relampago, LIDO)).toEqual({
      preco: 36.09, precoTabela: 42.75, emPromocao: true, promocaoTipo: 'lightning', priceId: '4', lidoEm: LIDO,
    });
  });
  it('sem promoção: tabela e tipo nulos, emPromocao false', () => {
    expect(parsePrecoComprador(semPromo, LIDO)).toMatchObject({ preco: 42.75, precoTabela: null, emPromocao: false, promocaoTipo: null });
  });
  it('metadado e valores divergem → emPromocao null, nunca false', () => {
    expect(parsePrecoComprador({ ...relampago, regular_amount: null }, LIDO)).toMatchObject({ emPromocao: null, precoTabela: null, promocaoTipo: 'lightning' });
  });
  it('tabela maior sem tipo é promoção', () => {
    expect(parsePrecoComprador({ ...relampago, metadata: null }, LIDO)).toMatchObject({ emPromocao: true, promocaoTipo: null });
  });
  it.each([null, {}, { ...relampago, amount: 0 }, { ...relampago, amount: '36' }, { ...relampago, currency_id: 'USD' }])(
    'leitura inválida → null (%#)', (x) => expect(parsePrecoComprador(x, LIDO)).toBeNull());
});

describe('lerPrecos', () => {
  it('um GET por MLB no contexto do marketplace; falha isolada não afeta os outros', async () => {
    const f = vi.fn(async (u: string | URL | Request) => String(u).includes('MLB2') ? resp({}, 500) : resp(relampago));
    const m = await criarLeitorPreco('tok', { f: f as typeof fetch }).lerPrecos(['MLB1', 'MLB2', 'MLB3']);
    expect([...m.keys()].sort()).toEqual(['MLB1', 'MLB3']);
    expect(String(f.mock.calls[0][0])).toBe('https://api.mercadolibre.com/items/MLB1/sale_price?context=channel_marketplace');
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('429 para de iniciar chamadas, sem repetir', async () => {
    const f = vi.fn(async () => resp({}, 429));
    const ids = Array.from({ length: 50 }, (_, i) => `MLB${i}`);
    expect((await criarLeitorPreco('tok', { f: f as unknown as typeof fetch }).lerPrecos(ids)).size).toBe(0);
    expect(f.mock.calls.length).toBeLessThanOrEqual(8);
  });
  it('prazo total: chamadas penduradas são abortadas e o resto não começa', async () => {
    const f = vi.fn((_u: unknown, i?: RequestInit) => new Promise<Response>((_, rej) => {
      i!.signal!.addEventListener('abort', () => rej(new Error('abort')));
    }));
    const ids = Array.from({ length: 50 }, (_, i) => `MLB${i}`);
    const t0 = Date.now();
    expect((await criarLeitorPreco('tok', { f: f as unknown as typeof fetch, prazoMs: 60 }).lerPrecos(ids)).size).toBe(0);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(f).toHaveBeenCalledTimes(8);
  });
  it('lista vazia não toca o ML', async () => {
    const f = vi.fn();
    await criarLeitorPreco('tok', { f: f as unknown as typeof fetch }).lerPrecos([]);
    expect(f).not.toHaveBeenCalled();
  });
  it('nunca loga o token nem o corpo', async () => {
    const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await criarLeitorPreco('segredo', { f: (async () => { throw new Error('segredo'); }) as unknown as typeof fetch }).lerPrecos(['MLB1']);
    expect(JSON.stringify(w.mock.calls)).not.toContain('segredo');
    w.mockRestore();
  });
});

describe('lerFimPromocao', () => {
  const agora = new Date('2026-11-25T21:00:00Z');
  const ler = (corpo: unknown, o: { priceId?: string; preco?: number; agora?: Date; status?: number } = {}) =>
    criarLeitorPreco('tok', { f: (async () => resp(corpo, o.status ?? 200)) as unknown as typeof fetch, agora: () => (o.agora ?? agora).getTime() })
      .lerFimPromocao([{ mlb: 'MLB1', priceId: o.priceId ?? '4', preco: o.preco ?? 36.09 }]);
  it('fim da linha do price_id', async () => {
    expect((await ler(prices)).get('MLB1')).toBe('2026-11-26T03:00:00.000Z');
  });
  it.each([
    ['price_id ausente', { priceId: '99' }], ['preço trocou', { preco: 37.19 }],
    ['fim já passou', { agora: new Date('2026-11-26T04:00:00Z') }], ['falha', { status: 500 }],
  ])('%s → sem fim', async (_n, o) => expect((await ler(prices, o)).has('MLB1')).toBe(false));
  it('price_id repetido é ambíguo → sem fim', async () => {
    expect((await ler({ prices: [...prices.prices, prices.prices[2]] })).has('MLB1')).toBe(false);
  });
  it('linha sem fim ou data inválida → sem fim', async () => {
    for (const end_time of [null, 'xx']) {
      expect((await ler({ prices: [{ id: '4', amount: 36.09, conditions: { end_time } }] })).has('MLB1')).toBe(false);
    }
  });
});

describe('leitor da requisição: prazo e parada divididos', () => {
  const alvo = [{ mlb: 'MLB1', priceId: '4', preco: 36.09 }];
  it('preço lido e depois 429: /prices não começa', async () => {
    const f = vi.fn(async (u: string | URL | Request) => String(u).includes('MLB2') ? resp({}, 429) : resp(relampago));
    const l = criarLeitorPreco('tok', { f: f as typeof fetch });
    expect([...(await l.lerPrecos(['MLB1', 'MLB2'])).keys()]).toEqual(['MLB1']);
    expect((await l.lerFimPromocao(alvo)).size).toBe(0);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('prazo gasto no preço: /prices não ganha prazo novo', async () => {
    const f = vi.fn(async () => resp(relampago));
    const l = criarLeitorPreco('tok', { f: f as unknown as typeof fetch, prazoMs: 30 });
    await l.lerPrecos(['MLB1']);
    await new Promise((r) => setTimeout(r, 50));
    expect((await l.lerFimPromocao(alvo)).size).toBe(0);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('promoção que vence entre as duas leituras → sem fim', async () => {
    let t = Date.parse('2026-11-26T02:59:59Z');
    const f = vi.fn(async (u: string | URL | Request) => resp(String(u).endsWith('/prices') ? prices : relampago));
    const l = criarLeitorPreco('tok', { f: f as typeof fetch, agora: () => t });
    await l.lerPrecos(['MLB1']);
    t += 2000;
    expect((await l.lerFimPromocao(alvo)).size).toBe(0);
  });
});
