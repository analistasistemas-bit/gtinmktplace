// ADR-0147 D-4: `/products/{id}/items` em 404 com a ficha em 200 é catálogo sem anúncio ativo — estado
// legítimo do mercado, não falha de leitura. Medido na Hairfly (06/11): tratado como falha, o produto
// nunca recebia nome nem snapshot e a tela ficava em "Ficha sem nome · coleta nunca".
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { lerOfertasDaFicha, processarLoteProdutos, type ContextoColeta, type ProdutoColeta } from '../processar.ts';

const resposta = (status: number, corpo: unknown = {}) => new Response(JSON.stringify(corpo), { status });

/** Responde por trecho de URL; o que não estiver mapeado é erro do teste, não 200 silencioso. */
function stubML(rotas: Record<string, () => Response>) {
  const chamadas: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    chamadas.push(url);
    const rota = Object.keys(rotas).find((r) => url.includes(r));
    if (!rota) throw new Error(`URL inesperada: ${url}`);
    return rotas[rota]();
  }));
  return chamadas;
}

afterEach(() => vi.unstubAllGlobals());

describe('lerOfertasDaFicha', () => {
  it('/items 404 com a ficha em 200: lista vazia e devolve a ficha', async () => {
    stubML({ '/items?': () => resposta(404), '/products/MLB1': () => resposta(200, { name: 'Creme 80g' }) });
    const r = await lerOfertasDaFicha('MLB1', 'tok');
    expect(r?.ficha).toEqual({ name: 'Creme 80g' });
    expect((r?.json as { results: unknown[] }).results).toEqual([]);
  });

  it('/items 404 com a ficha também em 404: falha, nunca "sem ofertas"', async () => {
    stubML({ '/items?': () => resposta(404), '/products/MLB1': () => resposta(404) });
    expect(await lerOfertasDaFicha('MLB1', 'tok')).toBeNull();
  });

  it('/items 500: falha, sem consultar a ficha', async () => {
    const chamadas = stubML({ '/items?': () => resposta(500) });
    expect(await lerOfertasDaFicha('MLB1', 'tok')).toBeNull();
    expect(chamadas.every((u) => u.includes('/items?'))).toBe(true);
  });

  it.each([
    ['429', () => resposta(429)],
    ['timeout', () => { throw new Error('timeout'); }],
  ])('%s seguido de 404 na repetição ainda confirma pela ficha', async (_nome, primeira) => {
    let chamadas = 0;
    stubML({
      '/items?': () => (++chamadas === 1 ? primeira() : resposta(404)),
      '/products/MLB1': () => resposta(200, { name: 'Creme 80g' }),
    });
    expect((await lerOfertasDaFicha('MLB1', 'tok'))?.ficha).toEqual({ name: 'Creme 80g' });
  });

  it('/items 200: devolve a resposta do ML sem ficha', async () => {
    const corpo = { results: [{ item_id: 'MLB9', price: 10, seller_id: 1 }], paging: { total: 1 } };
    stubML({ '/items?': () => resposta(200, corpo) });
    expect(await lerOfertasDaFicha('MLB1', 'tok')).toEqual({ json: corpo, ficha: null });
  });
});

const CTX: ContextoColeta = { token: 'tok', proprioSellerId: 999, naoClassificavel: false };
const PRODUTO = {
  id: 'p1', catalog_product_id: 'MLB1', codigo_pai: null, origem: 'auto', titulo: null,
  coleta_falhas_seguidas: 2, coleta_tentativa_em: null,
} as unknown as ProdutoColeta;
const OFERTA_GUARDADA = {
  item_id: 'MLB9', seller_id: 1, preco: 10, tier: null, frete_gratis: false, full_ml: false,
  loja_oficial: false, ativo: true, permalink: null, visitas_30d: null,
};

/** Grava o que o coletor escreve; leituras devolvem `ofertas` em pulse_ofertas_atual e [] no resto. */
function fakeAdmin(ofertas: unknown[]) {
  const escritas: Array<{ tabela: string; op: string; valor: unknown }> = [];
  const rpc = vi.fn(async () => ({ data: null, error: null }));
  const from = (tabela: string) => {
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api, eq: () => api, in: () => api, not: () => api, order: () => api, limit: () => api,
      gte: () => api, range: () => api, maybeSingle: async () => ({ data: null, error: null }),
      update: (valor: unknown) => { escritas.push({ tabela, op: 'update', valor }); return api; },
      upsert: (valor: unknown) => { escritas.push({ tabela, op: 'upsert', valor }); return api; },
      insert: (valor: unknown) => { escritas.push({ tabela, op: 'insert', valor }); return api; },
      then: (ok: (x: { data: unknown; error: null }) => unknown) =>
        ok({ data: tabela === 'pulse_ofertas_atual' ? ofertas : [], error: null }),
    };
    return api;
  };
  return { admin: { from, rpc } as unknown as SupabaseClient, escritas, rpc };
}

describe('processarLoteProdutos: ficha sem ofertas', () => {
  it('grava nome e snapshot, zera as falhas e não registra falha', async () => {
    stubML({ '/items?': () => resposta(404), '/products/MLB1': () => resposta(200, { name: 'Creme 80g' }) });
    const { admin, escritas, rpc } = fakeAdmin([]);

    await processarLoteProdutos(admin, 'org-1', CTX, [PRODUTO], 'quente', false);

    expect(rpc).not.toHaveBeenCalled();
    const patch = escritas.find((e) => e.tabela === 'pulse_produtos' && e.op === 'update')?.valor as Record<string, unknown>;
    expect(patch).toMatchObject({ titulo: 'Creme 80g', coleta_falhas_seguidas: 0, meu_preco: null });
    expect(patch.ultimo_snapshot_em).toEqual(expect.any(String));
  });

  it('oferta guardada é desativada sem virar alerta de concorrente_saiu', async () => {
    stubML({ '/items?': () => resposta(404), '/products/MLB1': () => resposta(200, { name: 'Creme 80g' }) });
    const { admin, escritas } = fakeAdmin([OFERTA_GUARDADA]);

    const r = await processarLoteProdutos(admin, 'org-1', CTX, [PRODUTO], 'quente', false);

    const desativadas = escritas.find((e) => e.tabela === 'pulse_ofertas')?.valor as Array<{ ativo: boolean }>;
    expect(desativadas.map((o) => o.ativo)).toEqual([false]);
    expect(escritas.some((e) => e.tabela === 'pulse_alertas')).toBe(false);
    expect(r.alertas).toBe(0);
  });

  it('ficha que não responde continua registrando falha, sem snapshot', async () => {
    stubML({ '/items?': () => resposta(404), '/products/MLB1': () => resposta(500) });
    const { admin, escritas, rpc } = fakeAdmin([OFERTA_GUARDADA]);

    await processarLoteProdutos(admin, 'org-1', CTX, [PRODUTO], 'quente', false);

    expect(rpc).toHaveBeenCalledWith('registrar_falha_coleta_pulse', { p_org: 'org-1', p_produto: 'p1' });
    expect(escritas).toEqual([]);
  });
});
