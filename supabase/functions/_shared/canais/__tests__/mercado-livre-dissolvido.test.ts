import { describe, it, expect, afterEach } from 'vitest';
import { mercadoLivreConnector } from '../mercado-livre';
import type { AtualizacaoCanonica } from '../contrato';

// ADR-0105: o ML DISSOLVE a família — fecha o item Legacy (status `closed`, sub_status VAZIO) e cria
// N itens novos sob um family_id. O guard de anúncio morto (lote #45) disparava antes de qualquer
// detecção de UP e o operador via "republique o produto". Agora o conector sinaliza tipado e a
// orquestração procura a família sucessora; anúncio de fato REMOVIDO continua falhando na hora.

const globalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = globalFetch; });

const ctxFake = { getToken: () => Promise.resolve('tok') };

const base: AtualizacaoCanonica = {
  itemExternoId: 'MLB4847766197',
  existentes: [], novas: [],
  capaFotoId: null, capa2FotoId: null, capa3FotoId: null, categoriaId: null,
  marca: null, dimensoes: null, desconto: null, precoFamilia: null, somenteEstoque: true,
};

const itemMorto = (over: Record<string, unknown> = {}) => ({
  id: 'MLB4847766197',
  title: 'Barbante Euroroma 4/6 600g 610mt | 85% Algodão',
  category_id: 'MLB270273',
  seller_id: 1003820507,
  status: 'closed',
  sub_status: [],
  family_id: null,
  family_name: null,
  pictures: [],
  variations: [
    { id: 1, seller_custom_field: '02186560', available_quantity: 10, picture_ids: [], attribute_combinations: [{ id: 'COLOR', value_name: 'Cru 100' }] },
    { id: 2, seller_custom_field: '02607131', available_quantity: 5, picture_ids: [], attribute_combinations: [{ id: 'COLOR', value_name: 'Vermelho 1000' }] },
  ],
  ...over,
});

/** Stub que responde o GET e denuncia qualquer escrita (a detecção não pode gastar PUT/POST). */
function stubGet(body: unknown) {
  let houveEscrita = false;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') houveEscrita = true;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  }) as typeof fetch;
  return () => houveEscrita;
}

describe('atualizarAnuncio em anúncio dissolvido pelo ML (ADR-0105)', () => {
  it('closed com sub_status vazio → MIGRADO_PARA_UP com título, categoria e o mapa sku→cor do item morto', async () => {
    const houveEscrita = stubGet(itemMorto());
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, {
      ...base,
      existentes: [{ sku: '02186560', estoque: 9, cor: 'Cru' }, { sku: '02607131', estoque: 4, cor: 'Vermelho' }],
    });
    expect(res.ok).toBe(false);
    expect(res.erro?.codigo).toBe('MIGRADO_PARA_UP');
    expect(res.erro?.up?.dissolvido).toMatchObject({
      titulo: 'Barbante Euroroma 4/6 600g 610mt | 85% Algodão',
      categoriaId: 'MLB270273',
      // sku → COR das variações do item morto: a única fonte em que o ML escreveu os dois lado a
      // lado. É por ela que o re-vínculo casa os irmãos, que não têm SKU nenhum.
      corPorSku: { '02186560': 'Cru 100', '02607131': 'Vermelho 1000' },
    });
    // A mensagem original do guard viaja intacta, para ser lançada se não houver família sucessora.
    expect(res.erro?.up?.dissolvido?.motivoFallback).toContain('Anúncio closed no Mercado Livre');
    expect(houveEscrita()).toBe(false);
  });

  it.each(['deleted', 'forbidden'])(
    'sub_status %s prova remoção → falha na hora, SEM sinalizar migração (nenhuma busca é gasta)',
    async (sub) => {
      stubGet(itemMorto({ sub_status: [sub] }));
      const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, {
        ...base, existentes: [{ sku: '02186560', estoque: 9, cor: 'Cru' }],
      });
      expect(res.ok).toBe(false);
      expect(res.erro?.codigo).not.toBe('MIGRADO_PARA_UP');
      expect(res.erro?.mensagemOperador).toContain('removido no Mercado Livre');
    },
  );

  it('sem cores casadas não há o que re-vincular → erro de sempre, sem sinalizar migração', async () => {
    stubGet(itemMorto());
    const res = await mercadoLivreConnector.atualizarAnuncio(ctxFake, { ...base, existentes: [] });
    expect(res.ok).toBe(false);
    expect(res.erro?.codigo).not.toBe('MIGRADO_PARA_UP');
  });

  it('atualizarEstoque em anúncio morto → causa certa, sem PUT (antes ia o erro cru do ML)', async () => {
    const houveEscrita = stubGet(itemMorto());
    const res = await mercadoLivreConnector.atualizarEstoque(ctxFake, 'MLB4847766197', [
      { sku: '02186560', estoque: 9 },
    ]);
    expect(res.ok).toBe(false);
    expect(res.erro?.mensagemOperador).toContain('Anúncio closed no Mercado Livre');
    expect(houveEscrita()).toBe(false);
  });

  it('atualizarEstoque em anúncio vivo continua repondo normalmente', async () => {
    let putBody: unknown = null;
    globalThis.fetch = ((_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putBody = JSON.parse(init.body as string);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify(itemMorto({ status: 'active' })), { status: 200 }));
    }) as typeof fetch;
    const res = await mercadoLivreConnector.atualizarEstoque(ctxFake, 'MLB4847766197', [
      { sku: '02186560', estoque: 9 },
    ]);
    expect(res.ok).toBe(true);
    expect(putBody).not.toBeNull();
  });
});
