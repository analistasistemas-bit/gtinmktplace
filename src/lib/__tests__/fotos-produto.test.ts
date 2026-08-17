import { describe, it, expect } from 'vitest';
import { montarMapasFoto, montarFotoResolver } from '../fotos-produto';
import type { VendaItem } from '../faturamento';

const item = (p: Partial<VendaItem>): VendaItem => ({
  id: 'i', ml_item_id: null, variation_id: null, titulo: null, codigo: null, cor: null,
  ean: null, quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...p,
});

const variacao = (codigo: string, path: string, ml_item_id: string, extra: Record<string, unknown> = {}) => ({
  imagem_path: path, ml_variation_id: null, gtin: null, codigo,
  familias: { ml_item_id }, ...extra,
});

describe('resolver de foto do produto', () => {
  // Caso real: familia de 9 cores publicada em User Products. O anuncio MLB4959919693 e o item
  // do "Amarelo Canario", mas tambem e o familias.ml_item_id — e o mapa por anuncio guardava a
  // foto da primeira variacao da lista (18760903, Vermelho). A venda do Amarelo aparecia vermelha.
  it('filho User Products mostra a foto da cor vendida, não a da primeira variação', () => {
    const m = montarMapasFoto(
      [
        variacao('18760903', 'fotos/vermelho.png', 'MLB4959919693'),
        variacao('26705421', 'fotos/amarelo.png', 'MLB4959919693'),
      ],
      [],
      [{ item_externo_id: 'MLB4959919693', sku: '26705421' }],
    );
    const foto = montarFotoResolver(m)(item({ ml_item_id: 'MLB4959919693', codigo: '26705421' }));
    expect(foto).toBe('fotos/amarelo.png');
  });

  it('anúncio de N fotos sem filho UP: cai no GTIN exato em vez de chutar a primeira', () => {
    const m = montarMapasFoto([
      variacao('A', 'fotos/azul.png', 'MLB9', { gtin: '07890000000017' }),
      variacao('B', 'fotos/verde.png', 'MLB9', { gtin: '07890000000024' }),
    ], []);
    const foto = montarFotoResolver(m)(item({ ml_item_id: 'MLB9', ean: '07890000000024' }));
    expect(foto).toBe('fotos/verde.png');
  });

  it('anúncio ambíguo e sem nada exato: capa da família, nunca a foto de outra cor', () => {
    const m = montarMapasFoto(
      [variacao('A', 'fotos/azul.png', 'MLB9'), variacao('B', 'fotos/verde.png', 'MLB9')],
      [{ ml_item_id: 'MLB9', capa_storage_path: 'fotos/capa.png' }],
    );
    expect(montarFotoResolver(m)(item({ ml_item_id: 'MLB9' }))).toBe('fotos/capa.png');
  });

  it('anúncio de cor única segue resolvendo pelo próprio anúncio', () => {
    const m = montarMapasFoto([variacao('A', 'fotos/unica.png', 'MLB1')], []);
    expect(montarFotoResolver(m)(item({ ml_item_id: 'MLB1' }))).toBe('fotos/unica.png');
  });

  it('variação explícita tem precedência sobre tudo', () => {
    const m = montarMapasFoto([
      variacao('A', 'fotos/azul.png', 'MLB1', { ml_variation_id: '77' }),
      variacao('B', 'fotos/verde.png', 'MLB1', { ml_variation_id: '88' }),
    ], []);
    expect(montarFotoResolver(m)(item({ ml_item_id: 'MLB1', variation_id: 88 }))).toBe('fotos/verde.png');
  });

  it('venda de catálogo resolve pelo anúncio dono (canônico)', () => {
    const m = montarMapasFoto([variacao('A', 'fotos/unica.png', 'MLB1')], []);
    const foto = montarFotoResolver(m, { listings: { MLBcatalogo: 'MLB1' } })(item({ ml_item_id: 'MLBcatalogo' }));
    expect(foto).toBe('fotos/unica.png');
  });

  it('sem mapas devolve null', () => {
    expect(montarFotoResolver(undefined)(item({ ml_item_id: 'MLB1' }))).toBeNull();
  });
});
