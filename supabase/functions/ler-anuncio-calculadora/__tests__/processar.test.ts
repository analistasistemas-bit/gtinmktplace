// Edge ler-anuncio-calculadora (somente leitura): preço vivo, modalidade, categoria e status do
// anúncio ML de UMA variação, para o prefill da calculadora. Vitest com deps injetadas.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  lerAnuncioCalculadora, lerCategoriaNome, lerItem, type DepsAnuncioCalculadora,
} from '../processar';
import { lerSalePriceML } from '../../_shared/ml/sale-price';

const ORG = 'org-1';
const OUTRA = 'org-2';

interface DB {
  familias: Array<{
    org_id: string; codigo_pai: string; ml_item_id: string | null; categoria_ml_id: string | null;
    kit_multiplicador: number | null; criado_em: string;
  }>;
  anunciosExternos: Array<{
    id: string; org_id: string; canal: string; codigo_pai: string; item_externo_id: string | null;
  }>;
  itensUP: Array<{ org_id: string; anuncio_externo_id: string; item_externo_id: string | null }>;
}

const dbVazio = (): DB => ({ familias: [], anunciosExternos: [], itensUP: [] });

/** Fake do SupabaseClient: select/eq/is/in/order/limit/maybeSingle — o que processar.ts usa. */
function fakeDb(db: DB) {
  // deno-lint-ignore no-explicit-any
  const tabelas: Record<string, any[]> = {
    familias: db.familias, anuncios_externos: db.anunciosExternos, anuncios_externos_itens: db.itensUP,
  };
  function chain(t: string) {
    // deno-lint-ignore no-explicit-any
    const filtros: Array<(r: any) => boolean> = [];
    let ordem: { col: string; asc: boolean } | null = null;
    let lim = Infinity;
    const linhas = () => {
      const r = (tabelas[t] ?? []).filter((x) => filtros.every((f) => f(x)));
      if (ordem) {
        const { col, asc } = ordem;
        r.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      return r.slice(0, lim);
    };
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api,
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return api; },
      is: (c: string, v: unknown) => { filtros.push((r) => (r[c] ?? null) === v); return api; },
      in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.includes(r[c])); return api; },
      order: (col: string, o?: { ascending?: boolean }) => { ordem = { col, asc: o?.ascending ?? true }; return api; },
      limit: (n: number) => { lim = n; return api; },
      maybeSingle: () => Promise.resolve({ data: linhas()[0] ?? null, error: null }),
      then: (resolve: (x: { data: unknown; error: null }) => unknown) => resolve({ data: linhas(), error: null }),
    };
    return api;
  }
  // deno-lint-ignore no-explicit-any
  return { from: (t: string) => chain(t) } as any;
}

const ITEM_ATIVO = { price: 100, listing_type_id: 'gold_special', category_id: 'MLB111', status: 'active' };

function deps(db: DB, over: Partial<DepsAnuncioCalculadora> = {}): DepsAnuncioCalculadora {
  return {
    db: fakeDb(db),
    obterToken: vi.fn(async () => 'tok'),
    lerItem: vi.fn(async () => ITEM_ATIVO),
    lerSalePrice: vi.fn(async () => null),
    lerCategoriaNome: vi.fn(async (id: string) => `Nome ${id}`),
    ...over,
  };
}

/** Org com o produto P1 publicado em MLB10 via familias + categoria de cadastro MLB999. */
function dbPublicado(): DB {
  const db = dbVazio();
  db.familias.push(
    { org_id: ORG, codigo_pai: 'P1', ml_item_id: 'MLB10', categoria_ml_id: 'MLB998', kit_multiplicador: null, criado_em: '2026-01-01' },
    { org_id: ORG, codigo_pai: 'P1', ml_item_id: 'MLB10', categoria_ml_id: 'MLB999', kit_multiplicador: null, criado_em: '2026-02-01' },
  );
  return db;
}

describe('lerAnuncioCalculadora — validação e vínculo', () => {
  it('item_id fora de ^MLB\\d+$ → 400, sem chamada ao ML', async () => {
    const d = deps(dbPublicado());
    for (const item_id of ['MLB', 'mlb10', 'MLB10/../x', 'X10', 10]) {
      expect((await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id })).status).toBe(400);
    }
    expect((await lerAnuncioCalculadora(d, ORG, { codigo_pai: '', item_id: null })).status).toBe(400);
    expect(d.lerItem).not.toHaveBeenCalled();
    expect(d.obterToken).not.toHaveBeenCalled();
  });

  it('item_id sem vínculo na org → 404, nenhuma chamada ao ML nem ao token', async () => {
    const db = dbPublicado();
    db.familias.push({ org_id: OUTRA, codigo_pai: 'P1', ml_item_id: 'MLB77', categoria_ml_id: 'MLB5', kit_multiplicador: null, criado_em: '2026-03-01' });
    db.anunciosExternos.push({ id: 'ae-x', org_id: OUTRA, canal: 'mercado_livre', codigo_pai: 'P1', item_externo_id: 'MLB78' });
    db.itensUP.push({ org_id: OUTRA, anuncio_externo_id: 'ae-x', item_externo_id: 'MLB79' });
    const d = deps(db);
    for (const item_id of ['MLB77', 'MLB78', 'MLB79', 'MLB12345']) {
      expect(await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id })).toEqual({ status: 404 });
    }
    expect(d.obterToken).not.toHaveBeenCalled();
    expect(d.lerItem).not.toHaveBeenCalled();
    expect(d.lerSalePrice).not.toHaveBeenCalled();
    expect(d.lerCategoriaNome).not.toHaveBeenCalled();
  });

  it('duas orgs com o mesmo codigo_pai: cada uma só vê o seu', async () => {
    const db = dbPublicado();
    db.familias.push({ org_id: OUTRA, codigo_pai: 'P1', ml_item_id: 'MLB20', categoria_ml_id: 'MLB5', kit_multiplicador: null, criado_em: '2026-03-01' });
    const d = deps(db);
    expect((await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB20' })).status).toBe(404);
    expect((await lerAnuncioCalculadora(d, OUTRA, { codigo_pai: 'P1', item_id: 'MLB10' })).status).toBe(404);
    expect((await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB10' })).status).toBe(200);
    expect((await lerAnuncioCalculadora(d, OUTRA, { codigo_pai: 'P1', item_id: 'MLB20' })).status).toBe(200);
  });

  it('vínculo via anuncios_externos e via anuncios_externos_itens (User Products) da org', async () => {
    const db = dbVazio();
    db.anunciosExternos.push({ id: 'ae-1', org_id: ORG, canal: 'mercado_livre', codigo_pai: 'P1', item_externo_id: 'MLB30' });
    db.itensUP.push({ org_id: ORG, anuncio_externo_id: 'ae-1', item_externo_id: 'MLB31' });
    const d = deps(db);
    expect((await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB30' })).status).toBe(200);
    expect((await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB31' })).status).toBe(200);
  });

  it('vínculo conferido só em linhas com canal = mercado_livre', async () => {
    const db = dbVazio();
    db.anunciosExternos.push({ id: 'ae-s', org_id: ORG, canal: 'shopee', codigo_pai: 'P1', item_externo_id: 'MLB40' });
    db.itensUP.push({ org_id: ORG, anuncio_externo_id: 'ae-s', item_externo_id: 'MLB41' });
    const d = deps(db);
    expect(await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB40' })).toEqual({ status: 404 });
    expect(await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB41' })).toEqual({ status: 404 });
    expect(d.lerItem).not.toHaveBeenCalled();
  });
});

describe('lerAnuncioCalculadora — leitura', () => {
  it('item_id null → não publicado, categoria do cadastro (família canônica criado_em desc)', async () => {
    const db = dbPublicado();
    // kit não é família canônica do produto
    db.familias.push({ org_id: ORG, codigo_pai: 'P1', ml_item_id: null, categoria_ml_id: 'MLB-KIT', kit_multiplicador: 2, criado_em: '2026-09-01' });
    const d = deps(db, { obterToken: vi.fn(async () => null) }); // sem conexão ML
    const r = await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: null });
    expect(r).toEqual({
      status: 200,
      body: {
        publicado: false, itemId: null, preco: null, precoOriginal: null, fontePreco: null,
        salePriceFalhou: false, modalidade: null, categoriaId: 'MLB999', categoriaNome: 'Nome MLB999',
        categoriaFonte: 'cadastro', statusAnuncio: null,
      },
    });
    expect(d.obterToken).not.toHaveBeenCalled();
    expect(d.lerItem).not.toHaveBeenCalled();
  });

  it('item_id null sem categoria no cadastro → categoria null, sem consultar nome', async () => {
    const d = deps(dbVazio());
    const r = await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P9', item_id: null });
    expect(r.body).toMatchObject({ publicado: false, categoriaId: null, categoriaNome: null, categoriaFonte: null });
    expect(d.lerCategoriaNome).not.toHaveBeenCalled();
  });

  it('sale_price com promoção → preco pago, precoOriginal regular, fonte sale_price', async () => {
    const d = deps(dbPublicado(), {
      lerSalePrice: vi.fn(async () => ({ preco: 89.9, precoRegular: 100, moeda: 'BRL' })),
    });
    const r = await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB10' });
    expect(r.body).toEqual({
      publicado: true, itemId: 'MLB10', preco: 89.9, precoOriginal: 100, fontePreco: 'sale_price',
      salePriceFalhou: false, modalidade: 'classico', categoriaId: 'MLB111', categoriaNome: 'Nome MLB111',
      categoriaFonte: 'item', statusAnuncio: 'active',
    });
    expect(d.obterToken).toHaveBeenCalledTimes(1);
    expect(d.lerItem).toHaveBeenCalledWith('tok', 'MLB10');
    expect(d.lerSalePrice).toHaveBeenCalledWith('tok', 'MLB10');
  });

  it('sale_price null → preco = price do /items, fonte items, salePriceFalhou', async () => {
    const d = deps(dbPublicado());
    const r = await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB10' });
    expect(r.body).toMatchObject({ preco: 100, precoOriginal: null, fontePreco: 'items', salePriceFalhou: true });
  });

  it('gold_pro → premium; category_id do item → fonte item; nome via /categories', async () => {
    const d = deps(dbPublicado(), {
      lerItem: vi.fn(async () => ({ ...ITEM_ATIVO, listing_type_id: 'gold_pro', category_id: 'MLB555' })),
    });
    const r = await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB10' });
    expect(r.body).toMatchObject({ modalidade: 'premium', categoriaId: 'MLB555', categoriaFonte: 'item', categoriaNome: 'Nome MLB555' });
    expect(d.lerCategoriaNome).toHaveBeenCalledWith('MLB555');
  });

  it('listing_type_id desconhecido (free) → modalidade null; item sem category_id → cadastro', async () => {
    const d = deps(dbPublicado(), {
      lerItem: vi.fn(async () => ({ price: 50, listing_type_id: 'free', category_id: null, status: 'active' })),
    });
    const r = await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB10' });
    expect(r.body).toMatchObject({ modalidade: null, categoriaId: 'MLB999', categoriaFonte: 'cadastro' });
  });

  it('/items falha → publicado, preco null, motivo, categoria do cadastro', async () => {
    const d = deps(dbPublicado(), {
      lerItem: vi.fn(async () => null),
      lerSalePrice: vi.fn(async () => ({ preco: 89.9, precoRegular: 100, moeda: 'BRL' })),
    });
    const r = await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB10' });
    expect(r.body).toMatchObject({
      publicado: true, itemId: 'MLB10', preco: null, precoOriginal: null, fontePreco: null, modalidade: null,
      categoriaId: 'MLB999', categoriaFonte: 'cadastro', statusAnuncio: null, motivo: 'falha_leitura_item',
    });
  });

  it('item publicado sem conexão ML → preco null, motivo sem_conexao, categoria do cadastro', async () => {
    const d = deps(dbPublicado(), { obterToken: vi.fn(async () => null) });
    const r = await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB10' });
    expect(r.body).toMatchObject({ publicado: true, preco: null, categoriaId: 'MLB999', categoriaFonte: 'cadastro', motivo: 'sem_conexao' });
    expect(d.lerItem).not.toHaveBeenCalled();
  });

  it('status ≠ active → publicado, statusAnuncio devolvido', async () => {
    for (const status of ['paused', 'closed', 'under_review']) {
      const d = deps(dbPublicado(), { lerItem: vi.fn(async () => ({ ...ITEM_ATIVO, status })) });
      const r = await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB10' });
      expect(r.body).toMatchObject({ publicado: true, statusAnuncio: status });
    }
  });
});

describe('deps reais — só GET em api.mercadolibre.com', () => {
  const globalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = globalFetch; });

  it('lerItem + lerSalePriceML + lerCategoriaNome: toda chamada é GET no ML', async () => {
    const chamadas: Array<{ url: string; method: string }> = [];
    globalThis.fetch = ((u: string, init?: RequestInit) => {
      chamadas.push({ url: u, method: init?.method ?? 'GET' });
      const corpo = u.includes('/sale_price')
        ? { amount: 89.9, regular_amount: 100, currency_id: 'BRL' }
        : u.includes('/categories/')
          ? { id: 'MLB111', name: 'Camisetas' }
          : { id: 'MLB10', ...ITEM_ATIVO, listing_type_id: 'gold_pro' };
      return Promise.resolve(new Response(JSON.stringify(corpo), { status: 200 }));
    }) as typeof fetch;

    const d: DepsAnuncioCalculadora = {
      db: fakeDb(dbPublicado()), obterToken: async () => 'tok', lerItem, lerSalePrice: lerSalePriceML, lerCategoriaNome,
    };
    const r = await lerAnuncioCalculadora(d, ORG, { codigo_pai: 'P1', item_id: 'MLB10' });
    expect(r.body).toMatchObject({
      preco: 89.9, precoOriginal: 100, fontePreco: 'sale_price', modalidade: 'premium',
      categoriaId: 'MLB111', categoriaNome: 'Camisetas', categoriaFonte: 'item', statusAnuncio: 'active',
    });
    expect(chamadas.length).toBe(3);
    for (const c of chamadas) {
      expect(c.method).toBe('GET');
      expect(new URL(c.url).host).toBe('api.mercadolibre.com');
    }
    expect(chamadas.map((c) => c.url)).toContain(
      'https://api.mercadolibre.com/items/MLB10?attributes=price,listing_type_id,category_id,status',
    );
  });

  it('lerItem: HTTP ≠ 2xx ou rede → null; leva timeout de 5 s', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    globalThis.fetch = (() => Promise.resolve(new Response('x', { status: 403 }))) as typeof fetch;
    expect(await lerItem('tok', 'MLB10')).toBeNull();
    expect(timeout).toHaveBeenCalledWith(5_000);
    globalThis.fetch = (() => Promise.reject(new Error('rede'))) as typeof fetch;
    expect(await lerItem('tok', 'MLB10')).toBeNull();
    timeout.mockRestore();
  });

  it('lerCategoriaNome: id inválido não chama o ML; falha → null', async () => {
    const f = vi.fn(() => Promise.resolve(new Response('x', { status: 500 })));
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await lerCategoriaNome('../x')).toBeNull();
    expect(f).not.toHaveBeenCalled();
    expect(await lerCategoriaNome('MLB1')).toBeNull();
  });
});
