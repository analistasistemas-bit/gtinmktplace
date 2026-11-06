// ADR-0119 Errata 13: o Radar segue a ficha real do item e tem fonte de preço fora da ficha.
// Caso medido na Hairfly (06/11): item Legacy convertido pelo ML em anúncio de catálogo de outra
// ficha, enquanto o banco guardava a ficha achada por GTIN e recusada pela trava.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { processarLoteProdutos, sincronizarRadar, type ContextoColeta, type ProdutoColeta } from '../processar.ts';

const resposta = (status: number, corpo: unknown = {}) => new Response(JSON.stringify(corpo), { status });

interface Item { id: string; status?: string; catalog_listing?: boolean; catalog_product_id?: string | null }

/** ML fake: bulk devolve `itens`, /items/{id} os atributos do item, /products/{id} as `fichas`. */
function stubML(itens: Item[], fichas: Record<string, unknown> = {}, extra: Record<string, () => Response> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const rota = Object.keys(extra).find((r) => url.includes(r));
    if (rota) return extra[rota]();
    if (url.includes('/items/bulk')) {
      const ids = new URL(url).searchParams.get('ids')!.split(',');
      return resposta(200, ids.map((id) => {
        const body = itens.find((i) => i.id === id);
        return body ? { status_code: 200, body: { status: 'active', ...body } } : { status_code: 404 };
      }));
    }
    const item = /\/items\/(MLB\d+)\?include_attributes/.exec(url)?.[1];
    if (item) return resposta(200, { ...itens.find((i) => i.id === item), attributes: [] });
    const ficha = /\/products\/(MLB\w+)$/.exec(url)?.[1];
    if (ficha && fichas[ficha]) return resposta(200, fichas[ficha]);
    return resposta(404);
  }));
}

const FICHA_UNIDADE = (id: string) => ({ id, attributes: [{ id: 'UNITS_PER_PACK', value_name: '1' }] });
const FICHA_KIT = (id: string) => ({ id, attributes: [{ id: 'UNITS_PER_PACK', value_name: '4' }] });

type Tabelas = Record<string, unknown[]>;

/** Banco fake: leituras devolvem `tabelas[t]`; escritas ficam em `escritas`, com os filtros usados. */
function fakeAdmin(tabelas: Tabelas, falhaUpsert = false) {
  const escritas: Array<{ tabela: string; op: string; valor: unknown; filtros: Record<string, unknown> }> = [];
  const from = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    let escrita: (typeof escritas)[number] | null = null;
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api, not: () => api, order: () => api, limit: () => api, range: () => api, gte: () => api,
      eq: (c: string, v: unknown) => { filtros[c] = v; return api; },
      neq: (c: string, v: unknown) => { filtros[`neq:${c}`] = v; return api; },
      in: (c: string, v: unknown) => { filtros[c] = v; return api; },
      maybeSingle: async () => ({ data: null, error: null }),
      update: (valor: unknown) => { escrita = { tabela, op: 'update', valor, filtros }; escritas.push(escrita); return api; },
      upsert: (valor: unknown) => { escrita = { tabela, op: 'upsert', valor, filtros }; escritas.push(escrita); return api; },
      then: (ok: (x: unknown) => unknown) => ok(
        escrita?.op === 'upsert' && falhaUpsert
          ? { data: null, error: { message: 'falhou' } }
          : { data: escrita ? null : tabelas[tabela] ?? [], error: null },
      ),
    };
    return api;
  };
  return { admin: { from, rpc: vi.fn(async () => ({ data: null, error: null })) } as unknown as SupabaseClient, escritas };
}

const ANUNCIO = {
  codigo_pai: '001', item_externo_id: 'MLB1',
  variacoes_externas: { '001': { variation_id: 'MLB1', catalog_product_id: 'MLBGUARDADA' } },
};
const VARIACAO = { catalog_product_id: 'MLBGUARDADA', gtin: '789', catalog_status: 'ficha_divergente' };

const upsertDe = (e: ReturnType<typeof fakeAdmin>['escritas']) =>
  e.find((x) => x.op === 'upsert')?.valor as Array<Record<string, unknown>>;
const updates = (e: ReturnType<typeof fakeAdmin>['escritas'], status: string) =>
  e.filter((x) => x.op === 'update' && (x.valor as { status?: string }).status === status);

afterEach(() => vi.unstubAllGlobals());

describe('sincronizarRadar: ficha real do item', () => {
  it('troca a ficha guardada pela real equivalente, herdando o EAN, e arquiva a antiga', async () => {
    stubML([{ id: 'MLB1', catalog_listing: true, catalog_product_id: 'MLBREAL' }], { MLBREAL: FICHA_UNIDADE('MLBREAL') });
    const { admin, escritas } = fakeAdmin({ anuncios_externos: [ANUNCIO], variacoes: [VARIACAO] });

    await sincronizarRadar(admin, 'org-1', 'tok');

    expect(upsertDe(escritas)).toEqual([expect.objectContaining({
      catalog_product_id: 'MLBREAL', codigo_pai: '001', gtin: '789', catalogo_status: 'vinculado',
    })]);
    expect(updates(escritas, 'arquivado')[0].filtros).toMatchObject({ catalog_product_id: ['MLBGUARDADA'], origem: 'auto' });
  });

  it('ficha real não equivalente entra como ficha_divergente', async () => {
    stubML([{ id: 'MLB1', catalog_listing: true, catalog_product_id: 'MLBREAL' }], { MLBREAL: FICHA_KIT('MLBREAL') });
    const { admin, escritas } = fakeAdmin({ anuncios_externos: [ANUNCIO], variacoes: [VARIACAO] });

    await sincronizarRadar(admin, 'org-1', 'tok');

    expect(upsertDe(escritas)[0]).toMatchObject({ catalog_product_id: 'MLBREAL', catalogo_status: 'ficha_divergente' });
  });

  it('item fora do catálogo mantém a ficha guardada', async () => {
    stubML([{ id: 'MLB1', catalog_listing: false, catalog_product_id: null }]);
    const { admin, escritas } = fakeAdmin({ anuncios_externos: [ANUNCIO], variacoes: [VARIACAO] });

    await sincronizarRadar(admin, 'org-1', 'tok');

    expect(upsertDe(escritas).map((r) => r.catalog_product_id)).toEqual(['MLBGUARDADA']);
    expect(updates(escritas, 'arquivado')).toEqual([]);
  });

  it('falha ao ler a ficha real mantém a guardada', async () => {
    stubML([{ id: 'MLB1', catalog_listing: true, catalog_product_id: 'MLBREAL' }]);
    const { admin, escritas } = fakeAdmin({ anuncios_externos: [ANUNCIO], variacoes: [VARIACAO] });

    await sincronizarRadar(admin, 'org-1', 'tok');

    expect(upsertDe(escritas).map((r) => r.catalog_product_id)).toEqual(['MLBGUARDADA']);
  });

  it('anúncio com várias variações não é tocado', async () => {
    stubML([{ id: 'MLB1', catalog_listing: true, catalog_product_id: 'MLBREAL' }], { MLBREAL: FICHA_UNIDADE('MLBREAL') });
    const varias = { ...ANUNCIO, variacoes_externas: { ...ANUNCIO.variacoes_externas, '002': { variation_id: '9' } } };
    const { admin, escritas } = fakeAdmin({ anuncios_externos: [varias], variacoes: [VARIACAO] });

    await sincronizarRadar(admin, 'org-1', 'tok');

    expect(upsertDe(escritas).map((r) => r.catalog_product_id)).toEqual(['MLBGUARDADA']);
  });

  it('anúncio em duas partições do mesmo código não é tocado', async () => {
    stubML([{ id: 'MLB1', catalog_listing: true, catalog_product_id: 'MLBREAL' }], { MLBREAL: FICHA_UNIDADE('MLBREAL') });
    const particao = { ...ANUNCIO, item_externo_id: 'MLB2' };
    const { admin, escritas } = fakeAdmin({ anuncios_externos: [ANUNCIO, particao], variacoes: [VARIACAO] });

    await sincronizarRadar(admin, 'org-1', 'tok');

    expect(upsertDe(escritas).map((r) => r.catalog_product_id)).toEqual(['MLBGUARDADA']);
  });

  it('ficha compartilhada com outro anúncio continua no Radar e não é arquivada', async () => {
    stubML([{ id: 'MLB1', catalog_listing: true, catalog_product_id: 'MLBREAL' }], { MLBREAL: FICHA_UNIDADE('MLBREAL') });
    const outro = { codigo_pai: '002', item_externo_id: 'MLB2', variacoes_externas: ANUNCIO.variacoes_externas };
    const { admin, escritas } = fakeAdmin({ anuncios_externos: [outro, ANUNCIO], variacoes: [VARIACAO] });

    await sincronizarRadar(admin, 'org-1', 'tok');

    expect(upsertDe(escritas).map((r) => r.catalog_product_id).sort()).toEqual(['MLBGUARDADA', 'MLBREAL']);
    expect(upsertDe(escritas).find((r) => r.catalog_product_id === 'MLBGUARDADA')?.codigo_pai).toBe('002');
    expect(updates(escritas, 'arquivado')).toEqual([]);
  });

  it('upsert que falha não arquiva a ficha antiga', async () => {
    stubML([{ id: 'MLB1', catalog_listing: true, catalog_product_id: 'MLBREAL' }], { MLBREAL: FICHA_UNIDADE('MLBREAL') });
    const { admin, escritas } = fakeAdmin({ anuncios_externos: [ANUNCIO], variacoes: [VARIACAO] }, true);

    await sincronizarRadar(admin, 'org-1', 'tok');

    expect(updates(escritas, 'arquivado')).toEqual([]);
  });

  it('linha auto arquivada cuja ficha voltou é reativada, sem tocar em pausado', async () => {
    stubML([{ id: 'MLB1', catalog_listing: false }]);
    const { admin, escritas } = fakeAdmin({ anuncios_externos: [ANUNCIO], variacoes: [VARIACAO] });

    await sincronizarRadar(admin, 'org-1', 'tok');

    const reativar = updates(escritas, 'ativo')[0];
    expect(reativar.valor).toMatchObject({ status: 'ativo', coleta_falhas_seguidas: 0 });
    expect(reativar.filtros).toMatchObject({ status: 'arquivado', origem: 'auto', catalog_product_id: ['MLBGUARDADA'] });
  });
});

const CTX: ContextoColeta = { token: 'tok', proprioSellerId: 999, naoClassificavel: false };
const produto = (over: Record<string, unknown> = {}) => ({
  id: 'p1', catalog_product_id: 'MLBFICHA', codigo_pai: '001', origem: 'auto', titulo: 'Creme',
  catalogo_status: 'vinculado', coleta_falhas_seguidas: 0, coleta_tentativa_em: null, ...over,
}) as unknown as ProdutoColeta;
const ANUNCIO_PLANO = { item_externo_id: 'MLB1', variacoes_externas: { '001': {} } };
const salePrice = (amount: number) => () => resposta(200, { amount, regular_amount: 25.55, currency_id: 'BRL' });
const fichaVazia = { '/products/MLBFICHA/items': () => resposta(404) };

async function coletar(p: ProdutoColeta, anuncios: unknown[]) {
  const banco = fakeAdmin({ anuncios_externos: anuncios });
  await processarLoteProdutos(banco.admin, 'org-1', CTX, [p], 'quente', false);
  return banco.escritas.find((e) => e.tabela === 'pulse_produtos' && e.op === 'update')?.valor as Record<string, unknown>;
}

describe('processarLoteProdutos: preço fora da ficha', () => {
  it('vinculado, ativo e fora da ficha usa /sale_price e marca a origem', async () => {
    stubML([{ id: 'MLB1', status: 'active' }], { MLBFICHA: { name: 'Creme' } }, { ...fichaVazia, '/sale_price': salePrice(21.9) });
    expect(await coletar(produto(), [ANUNCIO_PLANO])).toMatchObject({
      meu_preco: 21.9, meu_item_id: 'MLB1', meu_preco_fora_da_ficha: true,
    });
  });

  it('item pausado agora não ganha preço', async () => {
    stubML([{ id: 'MLB1', status: 'paused' }], { MLBFICHA: { name: 'Creme' } }, { ...fichaVazia, '/sale_price': salePrice(21.9) });
    expect(await coletar(produto(), [ANUNCIO_PLANO])).toMatchObject({ meu_preco: null, meu_preco_fora_da_ficha: false });
  });

  it('ficha_divergente não ganha preço', async () => {
    stubML([{ id: 'MLB1', status: 'active' }], { MLBFICHA: { name: 'Creme' } }, { ...fichaVazia, '/sale_price': salePrice(21.9) });
    expect(await coletar(produto({ catalogo_status: 'ficha_divergente' }), [ANUNCIO_PLANO]))
      .toMatchObject({ meu_preco: null, meu_preco_fora_da_ficha: false });
  });

  it('anúncio em partições não elege um item arbitrário', async () => {
    stubML([{ id: 'MLB1', status: 'active' }], { MLBFICHA: { name: 'Creme' } }, { ...fichaVazia, '/sale_price': salePrice(21.9) });
    expect(await coletar(produto(), [ANUNCIO_PLANO, { ...ANUNCIO_PLANO, item_externo_id: 'MLB2' }]))
      .toMatchObject({ meu_preco: null });
  });

  it('nossa oferta na ficha vence e não consulta /sale_price', async () => {
    const sale = vi.fn(salePrice(1));
    stubML([], {}, {
      '/products/MLBFICHA/items': () => resposta(200, {
        results: [{ item_id: 'MLB7', price: 30, seller_id: 999 }], paging: { total: 1 },
      }),
      '/sale_price': sale,
    });
    expect(await coletar(produto(), [ANUNCIO_PLANO])).toMatchObject({
      meu_preco: 30, meu_item_id: 'MLB7', meu_preco_fora_da_ficha: false,
    });
    expect(sale).not.toHaveBeenCalled();
  });
});
