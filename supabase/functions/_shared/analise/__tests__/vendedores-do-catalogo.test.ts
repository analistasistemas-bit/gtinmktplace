import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// O client real lê Deno.env; aqui o mock deixa exercitar hit, miss e Redis fora do ar.
const redis = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('../../redis/client.ts', () => ({
  redisGet: (chave: string) => redis.get(chave),
  redisSet: (chave: string, valor: string, ttl?: number) => redis.set(chave, valor, ttl),
}));
import {
  anunciosComCatalogo,
  catalogosDaAmostra,
  resolverVendedoresDosCatalogos,
} from '../vendedores-do-catalogo.ts';
import type { ItemVendas } from '../../pulse/sonar-vendas.ts';

function item(over: Partial<ItemVendas> = {}): ItemVendas {
  return {
    titulo: 'X', preco: 10, vendidos: 1, link: null, imagem: null, vendedor: null,
    seller_id: null, frete_gratis: null, loja_oficial: null, internacional: null, full: null,
    item_id: 'MLB1', catalog_product_id: null, avaliacao_nota: null, avaliacao_qtd: null,
    posicao: 1, patrocinado: null, selo: null, preco_anterior: null, desconto_pct: null,
    flex: null, category_id: null, ...over,
  } as ItemVendas;
}

beforeEach(() => {
  redis.get.mockReset().mockResolvedValue(null);
  redis.set.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe('catalogosDaAmostra / anunciosComCatalogo', () => {
  it('deduplica catálogos e ignora anúncio sem ficha', () => {
    const itens = [
      item({ item_id: 'A', catalog_product_id: 'MLB100' }),
      item({ item_id: 'B', catalog_product_id: 'MLB100' }),
      item({ item_id: 'C', catalog_product_id: 'MLB200' }),
      item({ item_id: 'D', catalog_product_id: null }),
    ];
    expect(catalogosDaAmostra(itens).sort()).toEqual(['MLB100', 'MLB200']);
    // 3 de 4 têm ponte — é o numerador honesto de 3.3 (ADR-0143 D-1).
    expect(anunciosComCatalogo(itens, new Set(['MLB100', 'MLB200']))).toBe(3);
  });

  it('catálogo cuja ficha falhou não conta como coberto', () => {
    const itens = [
      item({ item_id: 'A', catalog_product_id: 'MLB100' }),
      item({ item_id: 'B', catalog_product_id: 'MLB100' }),
      item({ item_id: 'C', catalog_product_id: 'MLB200' }),
    ];
    // MLB200 respondeu, MLB100 não: só 1 dos 3 anúncios tem ponte de verdade.
    expect(anunciosComCatalogo(itens, new Set(['MLB200']))).toBe(1);
    expect(anunciosComCatalogo(itens, new Set())).toBe(0);
  });

  it('amostra inteira sem catálogo não gera consulta nenhuma', () => {
    expect(catalogosDaAmostra([item({ catalog_product_id: null })])).toEqual([]);
    expect(anunciosComCatalogo([item({ catalog_product_id: null })], new Set())).toBe(0);
  });
});

describe('resolverVendedoresDosCatalogos', () => {
  it('junta vendedores de várias fichas e mapeia item_id → seller_id', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({
      results: url.includes('MLB100')
        ? [{ item_id: 'A', seller_id: 1, price: 10 }, { item_id: 'B', seller_id: 2, price: 20 }]
        : [{ item_id: 'C', seller_id: 2, price: 30 }, { item_id: 'D', seller_id: 3, price: 40 }],
    }), { status: 200 })));

    const r = await resolverVendedoresDosCatalogos(['MLB100', 'MLB200'], 'tok');
    expect(r.sellerIds.sort()).toEqual([1, 2, 3]);
    expect(r.sellerPorItem.get('A')).toBe(1);
    expect(r.sellerPorItem.get('D')).toBe(3);
    expect(r.catalogos_consultados).toBe(2);
    expect(r.catalogos_com_falha).toBe(0);
    expect([...r.catalogosOk].sort()).toEqual(['MLB100', 'MLB200']);
  });

  it('exclui a conta da própria organização do conjunto de concorrentes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      results: [
        { item_id: 'A', seller_id: 9757132, price: 10 },
        { item_id: 'B', seller_id: 42, price: 20 },
      ],
    }), { status: 200 })));

    const r = await resolverVendedoresDosCatalogos(['MLB100'], 'tok', 9757132);
    expect(r.sellerIds).toEqual([42]);
    expect(r.sellerPorItem.has('A')).toBe(false);
  });

  it('ficha que falha não derruba as outras e é contada', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (
      url.includes('MLB404')
        ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify({ results: [{ item_id: 'A', seller_id: 7, price: 10 }] }), { status: 200 })
    )));

    const r = await resolverVendedoresDosCatalogos(['MLB404', 'MLB200'], 'tok');
    expect(r.sellerIds).toEqual([7]);
    expect(r.catalogos_com_falha).toBe(1);
    expect(r.catalogos_consultados).toBe(2);
    // a ficha que falhou fica fora de catalogosOk — 3.3 não pode contá-la como coberta
    expect([...r.catalogosOk]).toEqual(['MLB200']);
  });

  it('sem catálogo nenhum não chama a API', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = await resolverVendedoresDosCatalogos([], 'tok');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.sellerIds).toEqual([]);
  });
});

describe('cache do catálogo (ADR-0143 D-7)', () => {
  const ficha = new Response(
    JSON.stringify({ results: [{ item_id: 'A', seller_id: 1, price: 10 }] }),
    { status: 200 },
  );

  it('grava a ficha com TTL de 24h e a lista COMPLETA — o filtro da própria conta é no uso', async () => {
    const fetchSpy = vi.fn(async () => ficha.clone());
    vi.stubGlobal('fetch', fetchSpy);

    await resolverVendedoresDosCatalogos(['MLB100'], 'tok', 1);
    expect(redis.set).toHaveBeenCalledWith(
      'sonar:cat-vendedores:v1:MLB100',
      JSON.stringify([{ item_id: 'A', seller_id: 1 }]),
      86_400,
    );
  });

  it('cache quente não chama o ML', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    redis.get.mockResolvedValue(JSON.stringify([{ item_id: 'A', seller_id: 5 }]));

    const r = await resolverVendedoresDosCatalogos(['MLB100'], 'tok');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.sellerIds).toEqual([5]);
    expect(r.catalogosOk.has('MLB100')).toBe(true);
  });

  it('Redis fora do ar degrada para busca ao vivo, nunca para conjunto vazio', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ficha.clone()));
    redis.get.mockRejectedValue(new Error('Redis 500'));
    redis.set.mockRejectedValue(new Error('Redis 500'));

    const r = await resolverVendedoresDosCatalogos(['MLB100'], 'tok');
    expect(r.sellerIds).toEqual([1]);
    expect(r.catalogos_com_falha).toBe(0);
  });

  it('falha do ML não cacheia — erro transitório não esconde o catálogo por 24h', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));

    const r = await resolverVendedoresDosCatalogos(['MLB100'], 'tok');
    expect(redis.set).not.toHaveBeenCalled();
    expect(r.catalogos_com_falha).toBe(1);
    expect(r.catalogosOk.size).toBe(0);
  });
});
