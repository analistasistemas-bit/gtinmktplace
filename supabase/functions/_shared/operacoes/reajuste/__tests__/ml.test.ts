import { describe, expect, it, vi } from 'vitest';
import { criarClienteReajusteML } from '../ml.ts';
import { SemAcessoStatusML } from '../../ml-status.ts';

const API = 'https://api.mercadolibre.com';
const resp = (status: number, corpo?: unknown) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });
const URL_VIVO = `${API}/items/bulk?ids=MLB1&attributes=status_code,body.id,body.price,body.status,body.sub_status,body.variations,body.catalog_listing,body.item_relations`;

describe('lerVivo', () => {
  it('Legacy com variações → VivoItem; URL do bulk e Bearer', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ status_code: 200, body: {
      id: 'MLB1', price: 100, status: 'active', sub_status: [], catalog_listing: false,
      variations: [{ id: 111, price: 100 }, { id: 222, price: '100' }], item_relations: [{ id: 'MLB9' }],
    } }]));
    expect(await criarClienteReajusteML('tok', f).lerVivo('MLB1')).toEqual({
      preco: 100, variacoes: [{ id: '111', preco: 100 }, { id: '222', preco: 100 }], status: 'active',
      sub_status: [], catalog_listing: false, tem_relacoes: true,
    });
    expect(f).toHaveBeenCalledWith(URL_VIVO, { headers: { Authorization: 'Bearer tok' } });
  });

  it('sem variações e sem relações → variacoes null, tem_relacoes false', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ status_code: 200, body: {
      id: 'MLB1', price: 50, status: 'paused', sub_status: ['out_of_stock'], catalog_listing: true, variations: [],
    } }]));
    expect(await criarClienteReajusteML('tok', f).lerVivo('MLB1')).toEqual({
      preco: 50, variacoes: null, status: 'paused', sub_status: ['out_of_stock'], catalog_listing: true, tem_relacoes: false,
    });
  });

  it('HTTP 401 → SemAcessoStatusML', async () => {
    const f = vi.fn().mockResolvedValue(resp(401));
    await expect(criarClienteReajusteML('tok', f).lerVivo('MLB1')).rejects.toBeInstanceOf(SemAcessoStatusML);
  });

  it('envelope 403 → SemAcessoStatusML', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ status_code: 403 }]));
    await expect(criarClienteReajusteML('tok', f).lerVivo('MLB1')).rejects.toBeInstanceOf(SemAcessoStatusML);
  });

  it('envelope 404 → Error "ML não devolveu o anúncio"', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ status_code: 404 }]));
    const e = await criarClienteReajusteML('tok', f).lerVivo('MLB1').catch((x) => x);
    expect(e).not.toBeInstanceOf(SemAcessoStatusML);
    expect(e.message).toBe('ML não devolveu o anúncio');
  });

  it('200 sem body → Error', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ status_code: 200 }]));
    await expect(criarClienteReajusteML('tok', f).lerVivo('MLB1')).rejects.toThrow('ML não devolveu o anúncio');
  });

  it('HTTP 500 → Error comum', async () => {
    const f = vi.fn().mockResolvedValue(resp(500));
    const e = await criarClienteReajusteML('tok', f).lerVivo('MLB1').catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e).not.toBeInstanceOf(SemAcessoStatusML);
  });
});

describe('putPreco', () => {
  const chamada = (f: ReturnType<typeof vi.fn>) => f.mock.calls[0] as [string, RequestInit];

  it('Legacy: PUT variations com o MESMO preço para todos os ids, sem quantity/pictures', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, {}));
    expect(await criarClienteReajusteML('tok', f).putPreco('MLB1', 99.9, ['111', '222'])).toEqual({ kind: 'ok' });
    const [url, init] = chamada(f);
    expect(url).toBe(`${API}/items/MLB1`);
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ variations: [{ id: 111, price: 99.9 }, { id: 222, price: 99.9 }] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('plano/UP: PUT {price}; 201 → ok', async () => {
    const f = vi.fn().mockResolvedValue(resp(201, {}));
    expect(await criarClienteReajusteML('tok', f).putPreco('MLB1', 42, null)).toEqual({ kind: 'ok' });
    expect(JSON.parse(chamada(f)[1].body as string)).toEqual({ price: 42 });
  });

  it('403 → lança SemAcessoStatusML', async () => {
    const f = vi.fn().mockResolvedValue(resp(403, { message: 'forbidden' }));
    await expect(criarClienteReajusteML('tok', f).putPreco('MLB1', 42, null)).rejects.toBeInstanceOf(SemAcessoStatusML);
  });

  it('400 → sem_escrita com status e message do corpo', async () => {
    const f = vi.fn().mockResolvedValue(resp(400, { message: 'price invalid' }));
    expect(await criarClienteReajusteML('tok', f).putPreco('MLB1', 42, null))
      .toEqual({ kind: 'sem_escrita', status: 400, mensagem: 'price invalid' });
  });

  it('429 → sem_escrita', async () => {
    const f = vi.fn().mockResolvedValue(resp(429, { message: 'too many' }));
    expect(await criarClienteReajusteML('tok', f).putPreco('MLB1', 42, null))
      .toEqual({ kind: 'sem_escrita', status: 429, mensagem: 'too many' });
  });

  it('500 → desconhecido', async () => {
    const f = vi.fn().mockResolvedValue(resp(500, { message: 'boom' }));
    expect((await criarClienteReajusteML('tok', f).putPreco('MLB1', 42, null)).kind).toBe('desconhecido');
  });

  it('fetch lança → desconhecido', async () => {
    const f = vi.fn().mockRejectedValue(new TypeError('network'));
    expect(await criarClienteReajusteML('tok', f).putPreco('MLB1', 42, null))
      .toEqual({ kind: 'desconhecido', mensagem: 'network' });
  });

  it('timeout de 15 s aborta → desconhecido', async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, rej) =>
        init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
      const p = criarClienteReajusteML('tok', f as unknown as typeof fetch).putPreco('MLB1', 42, null);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(f.mock.calls[0][1].signal!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await p).kind).toBe('desconhecido');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('participaPromocaoML', () => {
  const URL_ITEM = `${API}/seller-promotions/items/MLB1?app_version=v2`;
  const urlCand = (pid: string, tipo: string) =>
    `${API}/seller-promotions/promotions/${pid}/items?promotion_type=${tipo}&item_id=MLB1&app_version=v2`;
  const GET = { headers: { Authorization: 'Bearer tok' } };

  it('started → true', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ id: 'P1', type: 'DEAL', status: 'started' }]));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBe(true);
    expect(f).toHaveBeenCalledWith(URL_ITEM, GET);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('pending → true', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ id: 'P1', type: 'DEAL', status: 'pending' }]));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBe(true);
  });

  it('lista vazia → false', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, []));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBe(false);
  });

  it('candidate com visão da campanha started → true', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ id: 'C1', type: 'SMART', status: 'candidate' }]))
      .mockResolvedValueOnce(resp(200, { results: [{ id: 'MLB1', status: 'started' }] }));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBe(true);
    expect(f).toHaveBeenNthCalledWith(2, urlCand('C1', 'SMART'), GET);
  });

  it('candidate com visão da campanha candidate → false', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ id: 'C1', type: 'SMART', status: 'candidate' }, { id: 'P2', type: 'DEAL', status: 'finished' }]))
      .mockResolvedValueOnce(resp(200, { results: [{ id: 'MLB1', status: 'candidate' }] }));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBe(false);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('candidate com visão da campanha sem status → null (inconclusivo)', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ id: 'C1', type: 'SMART', status: 'candidate' }]))
      .mockResolvedValueOnce(resp(200, { results: [{ id: 'MLB1', offer_id: 'OFFER-X' }] }));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBeNull();
  });

  it('candidate com visão da campanha results vazio → false', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ id: 'C1', type: 'SMART', status: 'candidate' }]))
      .mockResolvedValueOnce(resp(200, { results: [] }));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBe(false);
  });

  it('falha na visão da campanha → null', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ id: 'C1', type: 'SMART', status: 'candidate' }]))
      .mockResolvedValueOnce(resp(500));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBeNull();
  });

  it('visão da campanha lança → null', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ id: 'C1', type: 'SMART', status: 'candidate' }]))
      .mockRejectedValueOnce(new TypeError('network'));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBeNull();
  });

  it('404 na visão por item → null', async () => {
    const f = vi.fn().mockResolvedValue(resp(404, { message: 'not found' }));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBeNull();
  });

  it('403 na visão por item → null', async () => {
    const f = vi.fn().mockResolvedValue(resp(403));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBeNull();
  });

  it('200 com corpo não-lista → null', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, { erro: 'x' }));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBeNull();
  });

  // ML real: PRICE_DISCOUNT candidate vem SEM id (desconto próprio possível, não campanha).
  it('candidate sem id (PRICE_DISCOUNT) → false, sem consultar campanha', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ type: 'PRICE_DISCOUNT', status: 'candidate' }, { id: '', type: 'X', status: 'candidate' }]));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('candidate sem id + candidate com id cuja campanha está started → true', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ type: 'PRICE_DISCOUNT', status: 'candidate' }, { id: 'C1', type: 'SMART', status: 'candidate' }]))
      .mockResolvedValueOnce(resp(200, { results: [{ id: 'MLB1', status: 'started' }] }));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBe(true);
    expect(f).toHaveBeenNthCalledWith(2, urlCand('C1', 'SMART'), GET);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('candidate sem id + candidate com id cuja campanha falha → null', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ type: 'PRICE_DISCOUNT', status: 'candidate' }, { id: 'C1', type: 'SMART', status: 'candidate' }]))
      .mockResolvedValueOnce(resp(500));
    expect(await criarClienteReajusteML('tok', f).participaPromocaoML('MLB1')).toBeNull();
    expect(f).toHaveBeenNthCalledWith(2, urlCand('C1', 'SMART'), GET);
  });
});
