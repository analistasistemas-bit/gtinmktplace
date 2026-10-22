/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { lerAnuncio } from '../pdp.ts';

const fx = (n: string) => readFileSync(new URL(`../__fixtures__/${n}`, import.meta.url), 'utf8').trim();

// Documento mínimo (ambiente node): só o que o parser usa.
function doc(scripts: Record<string, string>, h1 = 'Produto Sintético de Teste'): Document {
  return {
    getElementById: (id: string) => (id in scripts ? { textContent: scripts[id] } : null),
    querySelector: (s: string) => (s === 'h1' ? { textContent: h1 } : null),
  } as unknown as Document;
}
const nordic = (json: string) => ({ __NORDIC_RENDERING_CTX__: `var _n={};_n.ctx={};_n.ctx.r = ${json};_n.ctx.r.assets = {};` });
// Catálogo sintético com uma mutação aplicada ao initialState.
const com = (f: (is: any) => void) => {
  const j = JSON.parse(fx('pdp-catalogo-sintetico.json'));
  f(j.appProps.pageProps.initialState);
  return lerAnuncio(doc(nordic(JSON.stringify(j))));
};

describe('lerAnuncio', () => {
  it('extrai os campos do estado do Nordic', () => {
    expect(lerAnuncio(doc(nordic(fx('pdp-sintetico.json'))))).toEqual({
      ok: true,
      dados: { mlItemId: 'MLB1000000001', sellerId: '100001', catalogProductId: null, categoriaId: 'MLB122102', preco: 199.9, vendidosTexto: '+1000 vendidos', titulo: 'Produto Sintético de Teste' },
    });
  });
  it('catálogo sintético traz catalogProductId', () => {
    const r = lerAnuncio(doc(nordic(fx('pdp-catalogo-sintetico.json'))));
    expect(r.ok && r.dados.catalogProductId).toBe('MLB2000000001');
  });
  it('fallback __PRELOADED_STATE__', () => {
    const j = JSON.parse(fx('pdp-catalogo-sintetico.json')).appProps.pageProps.initialState;
    const r = lerAnuncio(doc({ __PRELOADED_STATE__: JSON.stringify({ initialState: j }) }));
    expect(r.ok && r.dados.mlItemId).toBe('MLB1000000001');
  });
  it('Nordic quebrado cai no __PRELOADED_STATE__', () => {
    const j = JSON.parse(fx('pdp-catalogo-sintetico.json')).appProps.pageProps.initialState;
    const r = lerAnuncio(doc({ __NORDIC_RENDERING_CTX__: '_n.ctx.r = {quebrado;_n.ctx.r.assets', __PRELOADED_STATE__: JSON.stringify(j) }));
    expect(r.ok && r.dados.mlItemId).toBe('MLB1000000001');
  });
  it('catalog: ignora not_apply/""/none antes do válido', () => {
    const r = com((is) => {
      is.track.melidata_event.event_data.catalog_product_id = 'not_apply';
      is.components.short_description[0].reviews.action.track.melidata_event.event_data.catalog_product_id = 'none';
    });
    expect(r.ok && r.dados.catalogProductId).toBe('MLB2000000001'); // vem de head[carousel_up_web].carousel_config.product_id
    const so = com((is) => {
      is.track.melidata_event.event_data.catalog_product_id = '';
      is.components.short_description[0].reviews.action.track.melidata_event.event_data.catalog_product_id = 'not_apply';
      is.components.head[0].carousel_config.product_id = 'none';
    });
    expect(so.ok && so.dados.catalogProductId).toBeNull();
  });
  it('catalog: ordem event_data de topo → reviews → head[carousel_up_web]', () => {
    const topo = com((is) => { is.track.melidata_event.event_data.catalog_product_id = 'MLB3000000003'; });
    expect(topo.ok && topo.dados.catalogProductId).toBe('MLB3000000003');
    const head = com((is) => { is.components.head[0].carousel_config.product_id = 'MLB4000000004'; });
    expect(head.ok && head.dados.catalogProductId).toBe('MLB2000000001'); // reviews vem antes do head
  });
  it('catalog: id válido fora dos caminhos medidos (isca) é ignorado', () => {
    const r = com((is) => {
      delete is.components.short_description[0].reviews;
      is.components.head[0].carousel_config.product_id = 'not_apply';
      // iscas: recomendado antes do anúncio, head sem o id medido, carrossel do content_right
      is.aaa_recomendados = { catalog_product_id: 'MLB9999999999', carousel_config: { product_id: 'MLB9999999998' } };
      is.components.head.unshift({ id: 'outro', carousel_config: { category_id: 'MLB122102', product_id: 'MLB9999999997' } });
      is.components.content_right.unshift({ id: 'recos', carousel_config: { product_id: 'MLB9999999996' }, catalog_product_id: 'MLB9999999995' });
      is.components.short_description.unshift({ id: 'x', catalog_product_id: 'MLB9999999994', track: { melidata_event: { event_data: { catalog_product_id: 'MLB9999999993' } } } });
    });
    expect(r.ok && r.dados.catalogProductId).toBeNull();
  });
  it('não pega id/vendedor/categoria/preço de outros lugares', () => {
    expect(
      com((is) => {
        delete is.track.melidata_event.event_data.category_id;
        delete is.components.head;
        is.components.related = [{ category_id: 'MLB999', x: { category_id: 'MLB999' } }];
      }),
    ).toEqual({ ok: false, motivo: 'campo_ausente:categoriaId' });
    expect(com((is) => { delete is.id; delete is.track.melidata_event.event_data.item_id; })).toEqual({ ok: false, motivo: 'campo_ausente:mlItemId' });
    expect(com((is) => { delete is.track.melidata_event.event_data.seller_id; delete is.components.content_right; })).toEqual({ ok: false, motivo: 'campo_ausente:sellerId' });
    expect(
      com((is) => {
        is.components.short_description = is.components.short_description.filter((c: any) => c.id !== 'price');
        is.components.other = [{ price: 5 }];
        is.track.melidata_event.event_data.price = 7;
      }),
    ).toEqual({ ok: false, motivo: 'campo_ausente:preco' });
  });
  it('vendedor via seller_data e preço como objeto {value}', () => {
    const r = com((is) => {
      delete is.track.melidata_event.event_data.seller_id;
      is.components.short_description.find((c: any) => c.id === 'price').action.track.melidata_event.event_data.price = { value: 150.5 };
    });
    expect(r.ok && [r.dados.sellerId, r.dados.preco]).toEqual(['100001', 150.5]);
  });
  it('sem estado', () => {
    expect(lerAnuncio(doc({}))).toEqual({ ok: false, motivo: 'estado_nao_encontrado' });
    expect(lerAnuncio(doc({ __NORDIC_RENDERING_CTX__: 'lixo' }))).toEqual({ ok: false, motivo: 'estado_nao_encontrado' });
  });
  it('sem preço', () => {
    expect(com((is) => { is.components.short_description = is.components.short_description.filter((c: any) => c.id !== 'price'); })).toEqual({ ok: false, motivo: 'campo_ausente:preco' });
  });
});
