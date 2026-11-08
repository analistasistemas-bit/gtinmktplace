import { describe, expect, it, vi } from 'vitest';
import { criarClienteML, SemEscritaPromocoes } from '../ml.ts';

const API = 'https://api.mercadolibre.com';
const resp = (status: number, corpo?: unknown) =>
  new Response(corpo === undefined ? null : JSON.stringify(corpo), { status });
const semEspera = () => vi.fn(async (_ms: number) => {});

// Formato real da visão da campanha (spike ADR-0174).
const naCampanha = {
  results: [{ id: 'MLB1', status: 'candidate', price: 38.79, original_price: 39.99,
    offer_id: 'CANDIDATE-MLB1-772', min_discounted_price: 7, max_discounted_price: 18.99 }],
  paging: { total: 1 },
};

describe('lerNaCampanha', () => {
  it('Relâmpago com um horário participando e outro convidado: participando + convite (emenda 2026-11-08 (2))', async () => {
    const corpo = { results: [
      { id: 'MLB1', ref_id: 'CANDIDATE-MLB1-77', status: 'candidate', price: 27.64, min_discounted_price: 8.55, stock: { min: 5, max: 100 } },
      { id: 'MLB1', ref_id: 'OFFER-MLB1-14', status: 'pending', price: 24.45, stock: { remaining_stock: 5 } },
    ] };
    const ml = criarClienteML('tok', vi.fn().mockResolvedValue(resp(200, corpo)), semEspera());
    expect(await ml.lerNaCampanha('LGH-MLB1000', 'LIGHTNING', 'MLB1')).toEqual({
      status: 'pending', preco_min: null, preco_max: null, offer_id: 'OFFER-MLB1-14', estoque_min: null, preco: 24.45,
      convite: { status: 'candidate', preco_min: 8.55, preco_max: null, offer_id: 'CANDIDATE-MLB1-77', estoque_min: 5, preco: 27.64 },
    });
  });

  it('lerOfertaNoItem com participando e convite lê o convite', async () => {
    const corpo = [
      { id: 'LGH-1', type: 'LIGHTNING', status: 'pending', start_date: '2026-11-12T00:00:00', finish_date: '2026-11-12T11:59:59' },
      { id: 'LGH-1', type: 'LIGHTNING', status: 'candidate', min_discounted_price: 5.7, max_discounted_price: 25.65, suggested_discounted_price: 24.23, stock: { min: 5 } },
    ];
    const ml = criarClienteML('tok', vi.fn().mockResolvedValue(resp(200, corpo)), semEspera());
    expect(await ml.lerOfertaNoItem('LGH-1', 'MLB1')).toMatchObject({ preco_max: 25.65, preco_sugerido: 24.23, estoque_min: 5, inicio: null });
  });

  it('results[0] → ItemNaCampanha; URL da visão da campanha e Bearer', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, naCampanha));
    const ml = criarClienteML('tok', f, semEspera());
    expect(await ml.lerNaCampanha('P-MLB9', 'SMART', 'MLB1')).toEqual({
      status: 'candidate', preco_min: 7, preco_max: 18.99, offer_id: 'CANDIDATE-MLB1-772', estoque_min: null, preco: 38.79,
    });
    expect(f.mock.calls[0][0]).toBe(`${API}/seller-promotions/promotions/P-MLB9/items?promotion_type=SMART&item_id=MLB1&app_version=v2`);
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer tok' } });
  });

  it('results null (item fora da campanha) → null; preço ausente → null', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(200, { results: null }))
      .mockResolvedValueOnce(resp(200, { results: [{ id: 'MLB1', status: 'started' }] }));
    const ml = criarClienteML('tok', f, semEspera());
    expect(await ml.lerNaCampanha('P', 'DEAL', 'MLB1')).toBeNull();
    expect(await ml.lerNaCampanha('P', 'DEAL', 'MLB1')).toEqual({ status: 'started', preco_min: null, preco_max: null, offer_id: null, estoque_min: null, preco: null });
  });

  it('SMART_LIGHTNING lê stock.min, preço e offer_id (spike); PRICE_MATCHING sem stock → estoque null', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(200, { results: [{ id: 'MLB5048402257', status: 'candidate', price: 64, original_price: 69.9,
      offer_id: 'CANDIDATE-MLB5048402257-1', meli_percentage: 3, seller_percentage: 5, stock: { min: 5, max: 197 } }] }))
      .mockResolvedValueOnce(resp(200, { results: [{ id: 'MLB5114275523', status: 'candidate', price: 69.98, offer_id: 'CANDIDATE-MLB5114275523-1',
        start_date: '2026-11-03T00:00:00Z', end_date: '2026-11-10T00:00:00Z' }] }));
    const ml = criarClienteML('tok', f, semEspera());
    expect(await ml.lerNaCampanha('P-MLB18055120', 'SMART_LIGHTNING', 'MLB5048402257')).toEqual({ status: 'candidate', preco_min: null, preco_max: null,
      offer_id: 'CANDIDATE-MLB5048402257-1', estoque_min: 5, preco: 64 });
    expect(await ml.lerNaCampanha('P-MLB18099366', 'PRICE_MATCHING', 'MLB5114275523')).toEqual({ status: 'candidate', preco_min: null, preco_max: null,
      offer_id: 'CANDIDATE-MLB5114275523-1', estoque_min: null, preco: 69.98 });
    expect(f.mock.calls[0][0]).toContain('promotion_type=SMART_LIGHTNING');
  });

  it('stock.min continua ignorado em DEAL/SMART/PRICE_MATCHING', async () => {
    const f = vi.fn().mockImplementation(async () => resp(200, { results: [{ id: 'MLB1', status: 'candidate', stock: { min: 5 } }] }));
    const ml = criarClienteML('tok', f, semEspera());
    for (const t of ['DEAL', 'SMART', 'PRICE_MATCHING'] as const) {
      expect(await ml.lerNaCampanha('P', t, 'MLB1')).toMatchObject({ estoque_min: null });
    }
  });

  // Spike 03/11 (Zaven): no participante, `price` da visão da campanha é o deal_price vigente.
  it('participante: preco = price da campanha', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, { results: [{ id: 'MLB1', status: 'started', price: 49.9, original_price: 73.25 }] }));
    expect(await criarClienteML('tok', f, semEspera()).lerNaCampanha('P', 'DEAL', 'MLB1')).toMatchObject({ status: 'started', preco: 49.9 });
  });

  it('500, 500, 200 → sucesso depois de 2 esperas de 1 s', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(500)).mockResolvedValueOnce(resp(500)).mockResolvedValueOnce(resp(200, naCampanha));
    const esperar = semEspera();
    const ml = criarClienteML('tok', f, esperar);
    expect(await ml.lerNaCampanha('P', 'DEAL', 'MLB1')).not.toBeNull();
    expect(esperar.mock.calls).toEqual([[1000], [1000]]);
  });

  it('500 × 3 → lança (sem token na mensagem)', async () => {
    const f = vi.fn().mockResolvedValue(resp(500));
    const ml = criarClienteML('segredo', f, semEspera());
    const e = await ml.lerNaCampanha('P', 'DEAL', 'MLB1').catch((x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('ML 500 em /seller-promotions/promotions');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('502 × 3 → lança com o status real', async () => {
    const f = vi.fn().mockResolvedValue(resp(502));
    const ml = criarClienteML('tok', f, semEspera());
    await expect(ml.lerNaCampanha('P', 'DEAL', 'MLB1')).rejects.toThrow('ML 502 em /seller-promotions/promotions');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('item sem status → lança (não inventa status)', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, { results: [{ id: 'MLB1', offer_id: 'OFFER-X' }] }));
    await expect(criarClienteML('tok', f, semEspera()).lerNaCampanha('P', 'SMART', 'MLB1')).rejects.toThrow('sem status');
  });

  it('403 → SemEscritaPromocoes, sem retry', async () => {
    const f = vi.fn().mockResolvedValue(resp(403, { message: 'forbidden' }));
    const ml = criarClienteML('tok', f, semEspera());
    await expect(ml.lerNaCampanha('P', 'DEAL', 'MLB1')).rejects.toBeInstanceOf(SemEscritaPromocoes);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

// Formato real da Relâmpago (spike 02/11/2026, MLB5244990621 / LGH-MLB1000).
describe('lerNaCampanha LIGHTNING', () => {
  it('lê ref_id e stock.min', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, { results: [{ id: 'MLB1', ref_id: 'OFFER-X-1', status: 'pending', price: 24.65,
        start_date: '2026-11-06T00:00:00', finish_date: '2026-11-06T11:59:59', stock: { remaining_stock: 5 } }] }))
      .mockResolvedValueOnce(resp(200, { results: [{ id: 'MLB1', ref_id: 'CANDIDATE-MLB1-5', status: 'candidate', price: 28.13,
        original_price: 29.0, min_discounted_price: 8.7, stock: { min: 5, max: 180 } }] }));
    const ml = criarClienteML('tok', f, semEspera());
    expect(await ml.lerNaCampanha('LGH-1', 'LIGHTNING', 'MLB1')).toEqual({
      status: 'pending', preco_min: null, preco_max: null, offer_id: 'OFFER-X-1', estoque_min: null, preco: 24.65,
    });
    expect(await ml.lerNaCampanha('LGH-1', 'LIGHTNING', 'MLB1')).toEqual({
      status: 'candidate', preco_min: 8.7, preco_max: null, offer_id: 'CANDIDATE-MLB1-5', estoque_min: 5, preco: 28.13,
    });
    expect(f.mock.calls[0][0]).toBe(`${API}/seller-promotions/promotions/LGH-1/items?promotion_type=LIGHTNING&item_id=MLB1&app_version=v2`);
  });

  it('ref_id fora do padrão OFFER-/CANDIDATE- não vira offer_id', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, { results: [{ id: 'MLB1', ref_id: '123', status: 'pending' }] }));
    expect((await criarClienteML('tok', f, semEspera()).lerNaCampanha('LGH-1', 'LIGHTNING', 'MLB1'))?.offer_id).toBeNull();
  });

  it('ref_id fora de LIGHTNING não vira offer_id (SMART/DEAL inalterados)', async () => {
    const f = vi.fn(async () => resp(200, { results: [{ id: 'MLB1', ref_id: 'CANDIDATE-MLB1-5', status: 'candidate' }] }));
    const ml = criarClienteML('tok', f, semEspera());
    expect((await ml.lerNaCampanha('P', 'SMART', 'MLB1'))?.offer_id).toBeNull();
    expect((await ml.lerNaCampanha('P', 'DEAL', 'MLB1'))?.offer_id).toBeNull();
  });

  it('stock.min fora de LIGHTNING → estoque_min null', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, { results: [{ id: 'MLB1', status: 'candidate', stock: { min: 5 } }] }));
    expect((await criarClienteML('tok', f, semEspera()).lerNaCampanha('P', 'DEAL', 'MLB1'))?.estoque_min).toBeNull();
  });

  it('prefere a linha participando', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, { results: [
      { id: 'MLB1', ref_id: 'CANDIDATE-MLB1-5', status: 'candidate', stock: { min: 5, max: 180 } },
      { id: 'MLB1', ref_id: 'OFFER-X-1', status: 'pending', stock: { remaining_stock: 5 } },
    ] }));
    expect(await criarClienteML('tok', f, semEspera()).lerNaCampanha('LGH-1', 'LIGHTNING', 'MLB1')).toEqual({
      status: 'pending', preco_min: null, preco_max: null, offer_id: 'OFFER-X-1', estoque_min: null, preco: null,
      convite: { status: 'candidate', preco_min: null, preco_max: null, offer_id: 'CANDIDATE-MLB1-5', estoque_min: 5, preco: null },
    });
  });
});

describe('lerOfertaNoItem', () => {
  const visaoItem = [
    { id: 'P-SMART', type: 'SMART', status: 'candidate', min_discounted_price: 1 },
    { id: 'LGH-OUTRA', type: 'LIGHTNING', status: 'candidate', min_discounted_price: 2, max_discounted_price: 3 },
    { id: 'LGH-1', type: 'LIGHTNING', status: 'candidate', ref_id: 'CANDIDATE-MLB1-5', min_discounted_price: 5.8,
      max_discounted_price: 26.1, suggested_discounted_price: 24.65, stock: { min: 5, max: 180 } },
  ];

  it('com o offer_id criado, lê a janela daquela oferta (não a de outro horário)', async () => {
    const corpo = [
      { id: 'LGH-1', type: 'LIGHTNING', status: 'pending', ref_id: 'OFFER-MLB1-1', start_date: '2026-11-10T12:00:00', finish_date: '2026-11-10T23:59:59' },
      { id: 'LGH-1', type: 'LIGHTNING', status: 'candidate', ref_id: 'CANDIDATE-MLB1-9', max_discounted_price: 25 },
      { id: 'LGH-1', type: 'LIGHTNING', status: 'pending', ref_id: 'OFFER-MLB1-2', start_date: '2026-11-12T00:00:00', finish_date: '2026-11-12T11:59:59' },
    ];
    const ml = criarClienteML('tok', vi.fn(async () => resp(200, corpo)), semEspera());
    expect(await ml.lerOfertaNoItem('LGH-1', 'MLB1', 'OFFER-MLB1-2')).toMatchObject({ inicio: '2026-11-12T00:00:00', fim: '2026-11-12T11:59:59' });
    // Oferta criada ainda não visível: sem janela, nunca a de outro horário (revisão Grok).
    expect(await ml.lerOfertaNoItem('LGH-1', 'MLB1', 'OFFER-MLB1-3')).toBeNull();
  });

  it('filtra a Relâmpago pelo id e tipo; URL da visão por item', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, visaoItem));
    expect(await criarClienteML('tok', f, semEspera()).lerOfertaNoItem('LGH-1', 'MLB1')).toEqual({
      preco_min: 5.8, preco_max: 26.1, preco_sugerido: 24.65, estoque_min: 5, inicio: null, fim: null,
    });
    expect(f.mock.calls[0][0]).toBe(`${API}/seller-promotions/items/MLB1?app_version=v2`);
  });

  it('janela de start_date/finish_date', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ id: 'LGH-1', type: 'LIGHTNING', status: 'pending',
      start_date: '2026-11-06T00:00:00', finish_date: '2026-11-06T11:59:59', stock: { remaining_stock: 5 } }]));
    expect(await criarClienteML('tok', f, semEspera()).lerOfertaNoItem('LGH-1', 'MLB1')).toEqual({
      preco_min: null, preco_max: null, preco_sugerido: null, estoque_min: null,
      inicio: '2026-11-06T00:00:00', fim: '2026-11-06T11:59:59',
    });
  });

  it('ausente (ou mesmo id com outro tipo) → null', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ id: 'LGH-1', type: 'SMART' }, ...visaoItem.slice(0, 2)]));
    expect(await criarClienteML('tok', f, semEspera()).lerOfertaNoItem('LGH-1', 'MLB1')).toBeNull();
  });

  it('500, 500, 200 → sucesso; 500 × 3 → lança; 404 → lança sem retry', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(500)).mockResolvedValueOnce(resp(502)).mockResolvedValueOnce(resp(200, visaoItem));
    const esperar = semEspera();
    expect(await criarClienteML('tok', f, esperar).lerOfertaNoItem('LGH-1', 'MLB1')).not.toBeNull();
    expect(esperar.mock.calls).toEqual([[1000], [1000]]);
    const g = vi.fn().mockResolvedValue(resp(500));
    await expect(criarClienteML('tok', g, semEspera()).lerOfertaNoItem('LGH-1', 'MLB1')).rejects.toThrow('ML 500 em /seller-promotions/items');
    expect(g).toHaveBeenCalledTimes(3);
    const h = vi.fn().mockResolvedValue(resp(404, { message: 'not found' }));
    await expect(criarClienteML('tok', h, semEspera()).lerOfertaNoItem('LGH-1', 'MLB1')).rejects.toThrow('ML 404: not found');
    expect(h).toHaveBeenCalledTimes(1);
  });

  it('403 → SemEscritaPromocoes', async () => {
    const f = vi.fn().mockResolvedValue(resp(403));
    await expect(criarClienteML('tok', f, semEspera()).lerOfertaNoItem('LGH-1', 'MLB1')).rejects.toBeInstanceOf(SemEscritaPromocoes);
  });
});

describe('post', () => {
  it('201 SMART devolve o offer_id novo; body em JSON', async () => {
    const f = vi.fn().mockResolvedValue(resp(201, { offer_id: 'OFFER-X', price: 38.79, original_price: 39.99 }));
    const ml = criarClienteML('tok', f, semEspera());
    const body = { promotion_id: 'P', promotion_type: 'SMART', offer_id: 'CANDIDATE-X' };
    expect(await ml.post('MLB1', body)).toEqual({ offer_id: 'OFFER-X', inicio: null, fim: null });
    expect(f.mock.calls[0][0]).toBe(`${API}/seller-promotions/items/MLB1?app_version=v2`);
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(body) });
  });

  it('201 DEAL sem offer_id → null', async () => {
    const f = vi.fn().mockResolvedValue(resp(201, { price: 18, original_price: 19.99, currency_id: 'BRL' }));
    expect(await criarClienteML('tok', f, semEspera()).post('MLB1', {})).toEqual({ offer_id: null, inicio: null, fim: null });
  });

  it('201 SMART_LIGHTNING devolve a janela do spike', async () => {
    const f = vi.fn().mockResolvedValue(resp(201, { offer_id: 'OFFER-X', price: 64, original_price: 69.9,
      start_date: '2026-11-04T12:00:00', end_date: '2026-11-04T23:59:59' }));
    expect(await criarClienteML('tok', f, semEspera()).post('MLB1', {}))
      .toEqual({ offer_id: 'OFFER-X', inicio: '2026-11-04T12:00:00', fim: '2026-11-04T23:59:59' });
  });

  it('403 → SemEscritaPromocoes; 400 → Error com a message do ML cortada em 200', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(403, {}))
      .mockResolvedValueOnce(resp(400, { message: 'x'.repeat(300) }));
    const ml = criarClienteML('segredo', f, semEspera());
    await expect(ml.post('MLB1', {})).rejects.toBeInstanceOf(SemEscritaPromocoes);
    const e = await ml.post('MLB1', {}).catch((x) => x);
    expect(e).not.toBeInstanceOf(SemEscritaPromocoes);
    expect(e.message).toBe(`ML 400: ${'x'.repeat(200)}`);
    expect(e.message).not.toContain('segredo');
  });
});

// Spike 03/11 (Zaven MLB5441057075): PUT → 200 {price, original_price, currency_id}.
describe('put', () => {
  it('200 → ok; mesma URL do POST com método PUT e body JSON', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, { price: 43.9, original_price: 73.25, currency_id: 'BRL' }));
    const body = { promotion_id: 'P', promotion_type: 'DEAL', deal_price: 43.9 };
    await criarClienteML('tok', f, semEspera()).put('MLB1', body);
    expect(f.mock.calls[0][0]).toBe(`${API}/seller-promotions/items/MLB1?app_version=v2`);
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify(body) });
  });
  it('403 → SemEscritaPromocoes; 400 → Error com a message do ML', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(403, {})).mockResolvedValueOnce(resp(400, { message: 'deal_price inválido' }));
    const ml = criarClienteML('tok', f, semEspera());
    await expect(ml.put('MLB1', {})).rejects.toBeInstanceOf(SemEscritaPromocoes);
    await expect(ml.put('MLB1', {})).rejects.toThrow('ML 400: deal_price inválido');
  });
});

describe('del', () => {
  it('monta a URL com a query recebida; 200 com corpo vazio → ok', async () => {
    const f = vi.fn().mockResolvedValue(resp(200));
    const q = 'promotion_type=SMART&promotion_id=P&offer_id=OFFER-X&app_version=v2';
    await criarClienteML('tok', f, semEspera()).del('MLB1', q);
    expect(f.mock.calls[0][0]).toBe(`${API}/seller-promotions/items/MLB1?${q}`);
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('401 → SemEscritaPromocoes; 404 → Error', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(401)).mockResolvedValueOnce(resp(404, { message: 'not found' }));
    const ml = criarClienteML('tok', f, semEspera());
    await expect(ml.del('MLB1', 'q')).rejects.toBeInstanceOf(SemEscritaPromocoes);
    await expect(ml.del('MLB1', 'q')).rejects.toThrow('ML 404: not found');
  });
});

describe('lerRelacoes', () => {
  it('item + relacionados por multiget: 2 GETs', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ status_code: 200, body: { id: 'MLB1', catalog_listing: false,
        item_relations: [{ id: 'MLB2', variation_id: null, stock_relation: 1 }] } }]))
      .mockResolvedValueOnce(resp(200, [{ status_code: 200, body: { id: 'MLB2', catalog_listing: true } }]));
    const ml = criarClienteML('tok', f, semEspera());
    expect(await ml.lerRelacoes('MLB1')).toEqual({ catalog_listing: false, relacionados: [{ id: 'MLB2', catalog_listing: true }], disponivel: null });
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0][0]).toBe(`${API}/items/bulk?ids=MLB1&attributes=status_code,body.id,body.catalog_listing,body.item_relations,body.available_quantity`);
    expect(f.mock.calls[1][0]).toBe(`${API}/items/bulk?ids=MLB2&attributes=status_code,body.id,body.catalog_listing`);
  });

  it('bulk: relacionado 404 sem body → rejeita (não vira catalog_listing:false)', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ status_code: 200, body: { id: 'MLB1', catalog_listing: false,
        item_relations: [{ id: 'MLB2', variation_id: null, stock_relation: 1 }] } }]))
      .mockResolvedValueOnce(resp(200, [{ status_code: 404 }]));
    await expect(criarClienteML('tok', f, semEspera()).lerRelacoes('MLB1')).rejects.toThrow('MLB2');
  });

  it('bulk: relacionado repetido vai UMA vez na URL', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ status_code: 200, body: { id: 'MLB1', catalog_listing: false, item_relations: [{ id: 'MLB2' }, { id: 'MLB2' }] } }]))
      .mockResolvedValueOnce(resp(200, [{ status_code: 200, body: { id: 'MLB2', catalog_listing: true } }]));
    await criarClienteML('tok', f, semEspera()).lerRelacoes('MLB1');
    expect(new URL(String(f.mock.calls[1][0])).searchParams.get('ids')).toBe('MLB2');
  });

  it('sem relações → 1 GET; 403 → SemEscritaPromocoes', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(200, [{ code: 200, body: { id: 'MLB1', catalog_listing: true } }]))
      .mockResolvedValueOnce(resp(403));
    const ml = criarClienteML('tok', f, semEspera());
    expect(await ml.lerRelacoes('MLB1')).toEqual({ catalog_listing: true, relacionados: [], disponivel: null });
    expect(f).toHaveBeenCalledTimes(1);
    await expect(ml.lerRelacoes('MLB1')).rejects.toBeInstanceOf(SemEscritaPromocoes);
  });

  it('relacionado com code 404 no 2º multiget → rejeita (não vira catalog_listing:false)', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(resp(200, [{ code: 200, body: { id: 'MLB1', catalog_listing: false,
        item_relations: [{ id: 'MLB2', variation_id: null, stock_relation: 1 }] } }]))
      .mockResolvedValueOnce(resp(200, [{ code: 404, body: { message: 'not found' } }]));
    await expect(criarClienteML('tok', f, semEspera()).lerRelacoes('MLB1')).rejects.toThrow('MLB2');
  });

  it('devolve disponivel de available_quantity', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ code: 200, body: { id: 'MLB1', catalog_listing: true, available_quantity: 180 } }]));
    expect(await criarClienteML('tok', f, semEspera()).lerRelacoes('MLB1')).toEqual({ catalog_listing: true, relacionados: [], disponivel: 180 });
  });

  it('item não devolvido pelo multiget → Error', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ code: 404, body: { message: 'not found' } }]));
    await expect(criarClienteML('tok', f, semEspera()).lerRelacoes('MLB1')).rejects.toThrow('MLB1');
  });
});

// ADR-0177: a saída de lerRelacoes é a entrada única do `decidir` (operacoes/decidir.ts). Nos dois
// envelopes, os casos que poderiam liberar a inscrição precisam sair iguais (caracterização).
describe.each(['code', 'status_code'] as const)('lerRelacoes — fronteira do motor de promoções [%s]', (campo) => {
  const cliente = (...respostas: unknown[]) => {
    const f = vi.fn();
    for (const r of respostas) f.mockResolvedValueOnce(resp(200, r));
    return criarClienteML('tok', f, semEspera());
  };
  it('item principal 200 SEM body → lança (não vira catalog_listing:false, que liberaria a inscrição)', async () => {
    await expect(cliente([{ [campo]: 200 }]).lerRelacoes('MLB1')).rejects.toThrow('MLB1');
  });
  it('relacionado 200 SEM body → rejeita (igual ao 404)', async () => {
    const c = cliente([{ [campo]: 200, body: { id: 'MLB1', catalog_listing: false, item_relations: [{ id: 'MLB2' }] } }], [{ [campo]: 200 }]);
    await expect(c.lerRelacoes('MLB1')).rejects.toThrow('MLB2');
  });
  it('relacionado repetido em item_relations: retorno conserva a repetição', async () => {
    const c = cliente(
      [{ [campo]: 200, body: { id: 'MLB1', catalog_listing: false, item_relations: [{ id: 'MLB2' }, { id: 'MLB2' }] } }],
      [{ [campo]: 200, body: { id: 'MLB2', catalog_listing: true } }],
    );
    expect(await c.lerRelacoes('MLB1')).toEqual({
      catalog_listing: false,
      relacionados: [{ id: 'MLB2', catalog_listing: true }, { id: 'MLB2', catalog_listing: true }], disponivel: null,
    });
  });
});
