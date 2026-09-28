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
  it('results[0] → ItemNaCampanha; URL da visão da campanha e Bearer', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, naCampanha));
    const ml = criarClienteML('tok', f, semEspera());
    expect(await ml.lerNaCampanha('P-MLB9', 'SMART', 'MLB1')).toEqual({
      status: 'candidate', preco_min: 7, preco_max: 18.99, offer_id: 'CANDIDATE-MLB1-772',
    });
    expect(f.mock.calls[0][0]).toBe(`${API}/seller-promotions/promotions/P-MLB9/items?promotion_type=SMART&item_id=MLB1&app_version=v2`);
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer tok' } });
  });

  it('results null (item fora da campanha) → null; preço ausente → null', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(200, { results: null }))
      .mockResolvedValueOnce(resp(200, { results: [{ id: 'MLB1', status: 'started' }] }));
    const ml = criarClienteML('tok', f, semEspera());
    expect(await ml.lerNaCampanha('P', 'DEAL', 'MLB1')).toBeNull();
    expect(await ml.lerNaCampanha('P', 'DEAL', 'MLB1')).toEqual({ status: 'started', preco_min: null, preco_max: null, offer_id: null });
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

describe('post', () => {
  it('201 SMART devolve o offer_id novo; body em JSON', async () => {
    const f = vi.fn().mockResolvedValue(resp(201, { offer_id: 'OFFER-X', price: 38.79, original_price: 39.99 }));
    const ml = criarClienteML('tok', f, semEspera());
    const body = { promotion_id: 'P', promotion_type: 'SMART', offer_id: 'CANDIDATE-X' };
    expect(await ml.post('MLB1', body)).toEqual({ offer_id: 'OFFER-X' });
    expect(f.mock.calls[0][0]).toBe(`${API}/seller-promotions/items/MLB1?app_version=v2`);
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify(body) });
  });

  it('201 DEAL sem offer_id → null', async () => {
    const f = vi.fn().mockResolvedValue(resp(201, { price: 18, original_price: 19.99, currency_id: 'BRL' }));
    expect(await criarClienteML('tok', f, semEspera()).post('MLB1', {})).toEqual({ offer_id: null });
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
      .mockResolvedValueOnce(resp(200, [{ code: 200, body: { id: 'MLB1', catalog_listing: false,
        item_relations: [{ id: 'MLB2', variation_id: null, stock_relation: 1 }] } }]))
      .mockResolvedValueOnce(resp(200, [{ code: 200, body: { id: 'MLB2', catalog_listing: true } }]));
    const ml = criarClienteML('tok', f, semEspera());
    expect(await ml.lerRelacoes('MLB1')).toEqual({ catalog_listing: false, relacionados: [{ id: 'MLB2', catalog_listing: true }] });
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[0][0]).toBe(`${API}/items?ids=MLB1&attributes=id,catalog_listing,item_relations`);
    expect(f.mock.calls[1][0]).toBe(`${API}/items?ids=MLB2&attributes=id,catalog_listing`);
  });

  it('sem relações → 1 GET; 403 → SemEscritaPromocoes', async () => {
    const f = vi.fn().mockResolvedValueOnce(resp(200, [{ code: 200, body: { id: 'MLB1', catalog_listing: true } }]))
      .mockResolvedValueOnce(resp(403));
    const ml = criarClienteML('tok', f, semEspera());
    expect(await ml.lerRelacoes('MLB1')).toEqual({ catalog_listing: true, relacionados: [] });
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

  it('item não devolvido pelo multiget → Error', async () => {
    const f = vi.fn().mockResolvedValue(resp(200, [{ code: 404, body: { message: 'not found' } }]));
    await expect(criarClienteML('tok', f, semEspera()).lerRelacoes('MLB1')).rejects.toThrow('MLB1');
  });
});
