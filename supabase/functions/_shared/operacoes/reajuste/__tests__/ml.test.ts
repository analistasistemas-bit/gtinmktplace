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

describe('lerOfertas', () => {
  const URL_ITEM = `${API}/seller-promotions/items/MLB1?app_version=v2`;
  const urlCand = (pid: string, tipo: string) =>
    `${API}/seller-promotions/promotions/${pid}/items?promotion_type=${tipo}&item_id=MLB1&app_version=v2`;
  const GET = { headers: { Authorization: 'Bearer tok' } };
  const LGH = {
    id: 'LGH-MLB1000', type: 'LIGHTNING', status: 'pending', price: 131.97, original_price: 189.9, ref_id: 'OFFER-9',
    start_date: '2026-11-07T00:00:00', finish_date: '2026-11-07T11:59:59',
  };

  it('LGH pending → oferta com o preço, id da oferta em ref_id e janela', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [LGH]));
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toEqual([{
      chave: 'OFFER-9', promocao_id: 'LGH-MLB1000', tipo: 'LIGHTNING', status: 'pending', preco: 131.97, offer_id: 'OFFER-9',
      inicio: '2026-11-07T00:00:00', fim: '2026-11-07T11:59:59',
    }]);
    expect(f).toHaveBeenCalledWith(URL_ITEM, GET);
  });

  it('duas ofertas na mesma Relâmpago, sem id → chaves distintas pela janela', async () => {
    const semId = { ...LGH, ref_id: undefined };
    const f = vi.fn().mockResolvedValue(resp(200, [semId, { ...semId, start_date: '2026-11-08T00:00:00', status: 'started' }]));
    const r = await criarClienteReajusteML('tok', f).lerOfertas('MLB1');
    expect(r?.map((x) => x.chave)).toEqual(['LGH-MLB1000:2026-11-07T00:00:00', 'LGH-MLB1000:2026-11-08T00:00:00']);
  });

  it('oferta sem preço utilizável → preço null (bloqueia), nunca descartada', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ id: 'D1', type: 'DEAL', status: 'started' }, { id: 'D2', type: 'DEAL', status: 'started', price: 0 }]));
    expect((await criarClienteReajusteML('tok', f).lerOfertas('MLB1'))?.map((x) => x.preco)).toEqual([null, null]);
  });

  it('oferta ativa sem id de campanha continua contando', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ type: 'PRICE_DISCOUNT', status: 'started', price: 50 }]));
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toMatchObject([{ promocao_id: 'PRICE_DISCOUNT', preco: 50 }]);
  });

  it('finished e candidate sem id → sem ofertas, sem consultar campanha', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ id: 'P', type: 'DEAL', status: 'finished' }, { type: 'PRICE_DISCOUNT', status: 'candidate' }]));
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toEqual([]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('409 depois 200 → sucesso', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(409)).mockResolvedValueOnce(resp(200, [LGH]));
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('409 duas vezes → null, sem terceira tentativa', async () => {
    const f = vi.fn().mockImplementation(async () => resp(409));
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toBeNull();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each([[500], [403], [404]])('%i → null', async (status) => {
    const f = vi.fn().mockResolvedValue(resp(status));
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('fetch lança, corpo não-lista ou entrada sem status → null', async () => {
    const cli = (f: unknown) => criarClienteReajusteML('tok', f as typeof fetch);
    expect(await cli(vi.fn().mockRejectedValue(new TypeError('network'))).lerOfertas('MLB1')).toBeNull();
    expect(await cli(vi.fn().mockResolvedValue(resp(200, { erro: 'x' }))).lerOfertas('MLB1')).toBeNull();
    expect(await cli(vi.fn().mockResolvedValue(resp(200, [{ id: 'P', type: 'DEAL' }]))).lerOfertas('MLB1')).toBeNull();
  });

  it.each([[''], ['paused_x']])('status %j na visão por item → null', async (status) => {
    const f = vi.fn().mockResolvedValue(resp(200, [LGH, { id: 'P', type: 'DEAL', status }]));
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toBeNull();
  });

  it.each([[''], ['paused_x']])('status %j na visão da campanha → null', async (status) => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ id: 'C1', type: 'SMART', status: 'candidate' }]))
      .mockResolvedValueOnce(resp(200, { results: [{ status }] }));
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toBeNull();
  });

  describe('paginação da visão da campanha', () => {
    const CAND = [{ id: 'C1', type: 'SMART', status: 'candidate' }];
    const pagina = (status: string, paging?: unknown) => resp(200, { results: [{ status, price: 80 }], paging });

    it.each([['searchAfter'], ['search_after']])('oferta na página seguinte (%s) é lida', async (campo) => {
      const f = vi.fn()
        .mockResolvedValueOnce(resp(200, CAND))
        .mockResolvedValueOnce(pagina('candidate', { [campo]: 'c 1' }))
        .mockResolvedValueOnce(pagina('started'));
      expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toMatchObject([{ preco: 80 }]);
      expect(f).toHaveBeenNthCalledWith(3, `${urlCand('C1', 'SMART')}&search_after=c%201`, GET);
    });

    it('cursor com página seguinte vazia → fim, sem ofertas', async () => {
      const f = vi.fn()
        .mockResolvedValueOnce(resp(200, CAND))
        .mockResolvedValueOnce(pagina('candidate', { searchAfter: 'c1' }))
        .mockResolvedValueOnce(resp(200, { results: [], paging: { searchAfter: 'c2' } }));
      expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toEqual([]);
      expect(f).toHaveBeenCalledTimes(3);
    });

    it('falha na página seguinte → null', async () => {
      const f = vi.fn()
        .mockResolvedValueOnce(resp(200, CAND))
        .mockResolvedValueOnce(pagina('candidate', { searchAfter: 'c1' }))
        .mockResolvedValueOnce(resp(500));
      expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toBeNull();
    });

    it('cursor repetido com itens → null, sem laço', async () => {
      const f = vi.fn().mockResolvedValueOnce(resp(200, CAND)).mockImplementation(async () => pagina('candidate', { searchAfter: 'c1' }));
      expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toBeNull();
      expect(f).toHaveBeenCalledTimes(3);
    });

    it('páginas sem fim → null', async () => {
      let n = 0;
      const f = vi.fn().mockResolvedValueOnce(resp(200, CAND)).mockImplementation(async () => pagina('candidate', { searchAfter: `c${++n}` }));
      expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toBeNull();
    });
  });

  it('candidate que a visão da campanha mostra started → oferta com o preço e o offer_id dela', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ id: 'C1', type: 'SMART', status: 'candidate', price: 90 }]))
      .mockResolvedValueOnce(resp(200, { results: [{ id: 'MLB1', status: 'started', price: 80, offer_id: 'OFFER-1' }] }));
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toMatchObject([
      { chave: 'OFFER-1', promocao_id: 'C1', tipo: 'SMART', status: 'started', preco: 80, offer_id: 'OFFER-1' },
    ]);
    expect(f).toHaveBeenNthCalledWith(2, urlCand('C1', 'SMART'), GET);
  });

  it('visão da campanha com CANDIDATE e OFFER do mesmo item → vale a participando', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ id: 'C1', type: 'SMART', status: 'candidate' }]))
      .mockResolvedValueOnce(resp(200, { results: [{ status: 'candidate', ref_id: 'CANDIDATE-1' }, { status: 'started', price: 80, ref_id: 'OFFER-1' }] }));
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toMatchObject([{ offer_id: 'OFFER-1', preco: 80 }]);
  });

  it('candidate que segue candidate, ou fora da campanha → sem ofertas', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ id: 'C1', type: 'SMART', status: 'candidate' }, { id: 'C2', type: 'DEAL', status: 'candidate' }]))
      .mockResolvedValueOnce(resp(200, { results: [{ status: 'candidate' }] }))
      .mockResolvedValueOnce(resp(200, { results: [] }));
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toEqual([]);
  });

  it('visão da campanha: 409 repete uma vez', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ id: 'C1', type: 'SMART', status: 'candidate' }]))
      .mockResolvedValueOnce(resp(409))
      .mockResolvedValueOnce(resp(200, { results: [{ status: 'started', price: 80 }] }));
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toHaveLength(1);
  });

  it.each([
    ['falha', () => resp(500)],
    ['resultado sem status', () => resp(200, { results: [{ offer_id: 'OFFER-X' }] })],
    ['corpo sem results', () => resp(200, {})],
  ])('visão da campanha inconclusiva (%s) → null, mesmo com outra oferta lida', async (_nome, campanha) => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [LGH, { id: 'C1', type: 'SMART', status: 'candidate' }]))
      .mockResolvedValueOnce(campanha());
    expect(await criarClienteReajusteML('tok', f).lerOfertas('MLB1')).toBeNull();
  });
});
