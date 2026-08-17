import { describe, it, expect } from 'vitest';
import { montarMapasCor, montarCorResolver, type LinhaVariacaoCor } from '../cor-produto';
import type { VendaItem } from '../faturamento';

const item = (p: Partial<VendaItem>): VendaItem => ({
  id: 'i', ml_item_id: null, variation_id: null, titulo: null, codigo: null, cor: null,
  ean: null, quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...p,
});

const variacao = (p: Partial<LinhaVariacaoCor> & { ml_item_id?: string | null }): LinhaVariacaoCor => ({
  codigo: null, cor: null, gtin: null, ml_variation_id: null,
  familias: { ml_item_id: p.ml_item_id ?? null }, ...p,
});

describe('resolver de cor do produto', () => {
  it('resolve por variação quando o anúncio tem variações', () => {
    const m = montarMapasCor([
      variacao({ codigo: 'A', cor: 'Azul', ml_variation_id: '111', ml_item_id: 'MLB1' }),
      variacao({ codigo: 'B', cor: 'Verde', ml_variation_id: '222', ml_item_id: 'MLB1' }),
    ], []);
    const r = montarCorResolver(m);
    expect(r(item({ ml_item_id: 'MLB1', variation_id: 222 }))).toBe('Verde');
  });

  it('resolve filho User Products pelo item, e o SKU exato vence o chute da família', () => {
    // Caso real: MLB4959919693 é filho UP (sku 26705421, "Amarelo Canário") E ml_item_id da
    // família, cuja primeira variação é outra cor — sem a sobreposição mostraria "Vermelho".
    const m = montarMapasCor([
      variacao({ codigo: '18760903', cor: 'Vermelho', ml_item_id: 'MLB4959919693' }),
      variacao({ codigo: '26705421', cor: 'Amarelo Canário', ml_item_id: 'MLB4959919693' }),
    ], [{ item_externo_id: 'MLB4959919693', sku: '26705421' }]);
    const r = montarCorResolver(m);
    expect(r(item({ ml_item_id: 'MLB4959919693', codigo: '18760903' }))).toBe('Amarelo Canário');
  });

  it('resolve item plano de família com uma cor só', () => {
    const m = montarMapasCor([
      variacao({ codigo: '00000005', cor: 'incolor', ml_item_id: 'MLB4982690837' }),
    ], []);
    expect(montarCorResolver(m)(item({ ml_item_id: 'MLB4982690837' }))).toBe('incolor');
  });

  it('não inventa cor quando o anúncio tem N cores e a venda não diz qual', () => {
    const m = montarMapasCor([
      variacao({ codigo: 'A', cor: 'Azul', ml_item_id: 'MLB9' }),
      variacao({ codigo: 'B', cor: 'Verde', ml_item_id: 'MLB9' }),
    ], []);
    expect(montarCorResolver(m)(item({ ml_item_id: 'MLB9' }))).toBeNull();
  });

  it('resolve venda de catálogo pelo anúncio dono (canônico)', () => {
    const m = montarMapasCor([
      variacao({ codigo: '00000005', cor: 'incolor', ml_item_id: 'MLB4982690837' }),
    ], []);
    const r = montarCorResolver(m, { listings: { MLB7343614472: 'MLB4982690837' } });
    expect(r(item({ ml_item_id: 'MLB7343614472' }))).toBe('incolor');
  });

  it('devolve null sem mapas e sem match', () => {
    expect(montarCorResolver(undefined)(item({ ml_item_id: 'MLB1' }))).toBeNull();
    expect(montarCorResolver(montarMapasCor([], []))(item({ ml_item_id: 'MLB1' }))).toBeNull();
  });

  // O sync grava `codigo`/`ean` da venda pelo mapa POR ANÚNCIO, semeado com a primeira variação da
  // família em ordem arbitrária (io.ts:96-98). Numa venda sem variação de anúncio multi-cor esses
  // campos apontam para outra cor — cair no fallback por ean/código traria a cor errada.
  it('anúncio de N cores + venda sem variação: não cai no fallback por ean/código', () => {
    const m = montarMapasCor([
      variacao({ codigo: 'A', cor: 'Azul', gtin: '07890000000017', ml_item_id: 'MLB9' }),
      variacao({ codigo: 'B', cor: 'Verde', gtin: '07890000000024', ml_item_id: 'MLB9' }),
    ], []);
    // A venda chegou com o código/EAN da variação "A" (arbitrária), mas pode ter sido a "B".
    const vendido = item({ ml_item_id: 'MLB9', codigo: 'A', ean: '07890000000017' });
    expect(montarCorResolver(m)(vendido)).toBeNull();
    // Com variação explícita, aí sim o código/EAN são exatos e o fallback é confiável.
    expect(montarCorResolver(m)(item({ ml_item_id: 'MLB9', variation_id: 77, codigo: 'A' }))).toBe('Azul');
  });

  it('resolve por EAN quando o anúncio não é conhecido (venda de catálogo)', () => {
    const m = montarMapasCor([
      variacao({ codigo: '00000005', cor: 'incolor', gtin: '07890000000017', ml_item_id: 'MLB1' }),
    ], []);
    expect(montarCorResolver(m)(item({ ml_item_id: 'MLBdesconhecido', ean: '07890000000017' }))).toBe('incolor');
  });

  it('resolve por código normalizado (venda "5" x catálogo "00000005")', () => {
    const m = montarMapasCor([variacao({ codigo: '00000005', cor: 'Preto', ml_item_id: 'MLB1' })], []);
    expect(montarCorResolver(m)(item({ ml_item_id: 'MLBoutro', codigo: '5' }))).toBe('Preto');
  });

  it('anula EAN e código disputados por cores diferentes', () => {
    const m = montarMapasCor([
      variacao({ codigo: 'X', cor: 'Azul', gtin: '07890000000017', ml_item_id: 'MLB1' }),
      variacao({ codigo: 'X', cor: 'Verde', gtin: '07890000000017', ml_item_id: 'MLB2' }),
    ], []);
    const r = montarCorResolver(m);
    expect(r(item({ ml_item_id: 'MLBz', ean: '07890000000017' }))).toBeNull();
    expect(r(item({ ml_item_id: 'MLBz', codigo: 'X' }))).toBeNull();
  });

  it('SKU de filho UP ambíguo anula o anúncio em vez de deixar a família decidir', () => {
    const m = montarMapasCor([
      variacao({ codigo: 'DUP', cor: 'Azul', ml_item_id: 'MLBfam' }),
      variacao({ codigo: 'DUP', cor: 'Verde', ml_item_id: 'MLBoutra' }),
      variacao({ codigo: 'UNI', cor: 'Bege', ml_item_id: 'MLBoutra' }),
    ], [{ item_externo_id: 'MLBfam', sku: 'DUP' }]);
    expect(montarCorResolver(m)(item({ ml_item_id: 'MLBfam' }))).toBeNull();
  });

  it('mesma cor com grafias diferentes não anula a chave', () => {
    const m = montarMapasCor([
      variacao({ codigo: 'A', cor: 'Azul', ml_item_id: 'MLB1' }),
      variacao({ codigo: 'B', cor: ' azul ', ml_item_id: 'MLB1' }),
    ], []);
    expect(montarCorResolver(m)(item({ ml_item_id: 'MLB1' }))).toBe('Azul');
  });
});
