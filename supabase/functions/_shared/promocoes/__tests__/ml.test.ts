import { describe, expect, it, vi } from 'vitest';
import {
  buscarItensML, criarGetJson, listarItensPromocao, listarPromocoes, normalizarItemML,
  normalizarItemPromocao, normalizarPromocao, SemAcessoPromocoes,
} from '../ml.ts';
import type { PromocaoML } from '../tipos.ts';
import promocoesUsuario from './fixtures/promocoes-usuario.json';
import itensDeal from './fixtures/itens-deal-p1.json';
import multiget from './fixtures/multiget.json';

describe('normalizadores', () => {
  it('promoção: campos do v2; sem id (PRICE_DISCOUNT) → null', () => {
    expect(normalizarPromocao({ id: 'P-MLB1', type: 'DEAL', name: '10.10', status: 'pending',
      start_date: '2026-10-10T00:00:00Z', finish_date: '2026-10-11T00:00:00Z', deadline_date: '2026-10-08T21:00:00Z',
      benefits: { meli_percent: 30 } })).toMatchObject({
      id: 'P-MLB1', tipo: 'DEAL', nome: '10.10', status: 'pending', prazo_adesao: '2026-10-08T21:00:00Z',
      beneficios: { meli_percent: 30 },
    });
    expect(normalizarPromocao({ type: 'PRICE_DISCOUNT' })).toBeNull();
  });

  it('item da promoção: preços, co-participação e estoque do relâmpago', () => {
    expect(normalizarItemPromocao({ id: 'MLB7', status: 'candidate', price: 45, original_price: 59.9,
      min_discounted_price: 40, max_discounted_price: 55, suggested_discounted_price: 49.9,
      meli_percentage: 30, seller_percentage: 70, stock: { min: 5, max: 50 } })).toEqual({
      ml_item_id: 'MLB7', status: 'candidate', preco_original: 59.9, preco_promo: 45, preco_min: 40, preco_max: 55,
      preco_sugerido: 49.9, ml_pct: 30, vendedor_pct: 70, estoque_min: 5, estoque_max: 50,
    });
  });

  it('item do ML: cor e SKU por variação; UP sem variações', () => {
    const legacy = normalizarItemML({ id: 'MLB1', title: 'Toalha', secure_thumbnail: 'https://x/t.jpg',
      permalink: 'https://p', listing_type_id: 'gold_special', category_id: 'MLB123',
      attributes: [{ id: 'GTIN', value_name: '789' }],
      variations: [{ id: 11, seller_custom_field: 'SKU-A',
        attribute_combinations: [{ id: 'COLOR', value_name: 'Azul' }], attributes: [{ id: 'GTIN', value_name: '0789' }] }] });
    expect(legacy.variacoes).toEqual([{ variation_id: 11, cor: 'Azul', sku: 'SKU-A', gtin: '0789' }]);
    expect(legacy).toMatchObject({ categoria: 'MLB123', listing_type_id: 'gold_special', thumbnail: 'https://x/t.jpg', gtin: '789' });
    const up = normalizarItemML({ id: 'MLB2', attributes: [{ id: 'SELLER_SKU', value_name: '00123' }] });
    expect(up).toMatchObject({ sku: '00123', variacoes: [] });
  });
});

describe('paginação', () => {
  it('itens: segue o cursor searchAfter até acabar', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ results: [{ id: 'A', status: 'candidate' }], paging: { searchAfter: 'c1' } })
      .mockResolvedValueOnce({ results: [{ id: 'B', status: 'started' }], paging: {} });
    const p = { id: 'P-1', tipo: 'DEAL' } as PromocaoML;
    const itens = await listarItensPromocao(get, p);
    expect(itens.map((i) => i.ml_item_id)).toEqual(['A', 'B']);
    expect(get.mock.calls[0][0]).toBe('/seller-promotions/promotions/P-1/items?promotion_type=DEAL&app_version=v2&limit=50');
    expect(get.mock.calls[1][0]).toContain('&search_after=c1');
  });

  it('itens: cursor repetido não vira laço infinito', async () => {
    const get = vi.fn().mockResolvedValue({ results: [{ id: 'A', status: 'candidate' }], paging: { searchAfter: 'c1' } });
    await listarItensPromocao(get, { id: 'P', tipo: 'DEAL' } as PromocaoML);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('promoções: pagina por offset', async () => {
    const pagina = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `P${i}`, type: 'SMART', status: 'started' }));
    const get = vi.fn().mockResolvedValueOnce({ results: pagina(50) }).mockResolvedValueOnce({ results: pagina(3) });
    expect((await listarPromocoes(get, '99')).length).toBe(53);
    expect(get.mock.calls[1][0]).toBe('/seller-promotions/users/99?app_version=v2&limit=50&offset=50');
  });

  it('promoções: paging.total maior que o lido falha LOUD', async () => {
    const pagina = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `P${i}`, type: 'SMART', status: 'started' }));
    const get = vi.fn()
      .mockResolvedValueOnce({ results: pagina(50), paging: { total: 60 } })
      .mockResolvedValueOnce({ results: pagina(3), paging: { total: 60 } });
    await expect(listarPromocoes(get, '99')).rejects.toThrow(/53.*60/);
  });

  it('promoções: laço esgotado falha LOUD', async () => {
    const cheia = Array.from({ length: 50 }, (_, i) => ({ id: `P${i}`, type: 'SMART', status: 'started' }));
    const get = vi.fn().mockResolvedValue({ results: cheia });
    await expect(listarPromocoes(get, '99')).rejects.toThrow(/não terminou/);
  });

  it('multiget: blocos de 20 e ignora code ≠ 200', async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `MLB${i}`);
    const get = vi.fn(async (path: string) => {
      const lote = decodeURIComponent(path.split('ids=')[1].split('&')[0]).split(',');
      return lote.map((id) => (id === 'MLB3' ? { code: 404, body: {} } : { code: 200, body: { id } }));
    });
    const m = await buscarItensML(get, ids);
    expect(get).toHaveBeenCalledTimes(3);
    expect(m.size).toBe(44);
    expect(m.has('MLB3')).toBe(false);
  });
});

describe('criarGetJson', () => {
  it('401/403 viram SemAcessoPromocoes; outros erros viram Error', async () => {
    const f403 = vi.fn(async () => new Response('{}', { status: 403 }));
    await expect(criarGetJson('t', f403 as unknown as typeof fetch)('/x')).rejects.toBeInstanceOf(SemAcessoPromocoes);
    const f500 = vi.fn(async () => new Response('{}', { status: 500 }));
    await expect(criarGetJson('t', f500 as unknown as typeof fetch)('/x')).rejects.toThrow('ML 500');
  });
  it('só GET, com Bearer', async () => {
    const f = vi.fn(async () => new Response('{"ok":1}', { status: 200 }));
    await criarGetJson('tok', f as unknown as typeof fetch)('/y');
    expect(f).toHaveBeenCalledWith('https://api.mercadolibre.com/y', { method: 'GET', headers: { Authorization: 'Bearer tok' } });
  });
});

describe('fixtures reais (Task 0)', () => {
  it('todas as promoções com id normalizam com tipo e status', () => {
    const ps = (promocoesUsuario as { results: Record<string, unknown>[] }).results
      .map(normalizarPromocao).filter((p) => p != null);
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) { expect(p!.tipo).not.toBe('DESCONHECIDO'); expect(p!.status).not.toBe('desconhecido'); }
  });
  it('itens de DEAL trazem faixa e sugerido', () => {
    const it0 = normalizarItemPromocao((itensDeal as { results: Record<string, unknown>[] }).results[0])!;
    expect(it0.preco_min).not.toBeNull();
    expect(it0.preco_max).not.toBeNull();
    expect(it0.preco_sugerido).not.toBeNull();
  });
  it('multiget: item Legacy multi-cor tem cor por variação', () => {
    const itens = (multiget as { code: number; body: Record<string, unknown> }[]).map((x) => normalizarItemML(x.body));
    expect(itens.some((i) => i.variacoes.length > 1 && i.variacoes.every((v) => v.cor))).toBe(true);
    for (const i of itens) expect(i.thumbnail).toMatch(/^https:\/\//);
  });
});
