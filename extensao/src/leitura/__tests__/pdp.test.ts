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
  it('catalog: ignora not_apply/""/none antes do válido; preço do componente price', () => {
    const j = {
      id: 'MLB1000000001',
      track: { melidata_event: { event_data: { seller_id: 100001, catalog_product_id: 'not_apply' } } },
      components: {
        head: [{ carousel_config: { category_id: 'MLB122102', product_id: 'MLB2000000001' } }],
        short_description: [
          { id: 'x', reviews: { action: { track: { melidata_event: { event_data: { catalog_product_id: 'none', price: 5 } } } } } },
          { id: 'price', action: { track: { melidata_event: { event_data: { catalog_product_id: '', price: 199.9 } } } } },
        ],
      },
    };
    const r = lerAnuncio(doc(nordic(JSON.stringify({ appProps: { pageProps: { initialState: j } } }))));
    expect(r.ok && [r.dados.catalogProductId, r.dados.preco, r.dados.categoriaId]).toEqual(['MLB2000000001', 199.9, 'MLB122102']);
  });
  it('sem estado', () => {
    expect(lerAnuncio(doc({}))).toEqual({ ok: false, motivo: 'estado_nao_encontrado' });
    expect(lerAnuncio(doc({ __NORDIC_RENDERING_CTX__: 'lixo' }))).toEqual({ ok: false, motivo: 'estado_nao_encontrado' });
  });
  it('sem preço', () => {
    const j = JSON.parse(fx('pdp-sintetico.json'));
    delete j.appProps.pageProps.initialState.track.melidata_event.event_data.price;
    expect(lerAnuncio(doc(nordic(JSON.stringify(j))))).toEqual({ ok: false, motivo: 'campo_ausente:preco' });
  });
});
