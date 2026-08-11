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
    const r = montarCorResolver(m, { MLB7343614472: 'MLB4982690837' });
    expect(r(item({ ml_item_id: 'MLB7343614472' }))).toBe('incolor');
  });

  it('devolve null sem mapas e sem match', () => {
    expect(montarCorResolver(undefined)(item({ ml_item_id: 'MLB1' }))).toBeNull();
    expect(montarCorResolver(montarMapasCor([], []))(item({ ml_item_id: 'MLB1' }))).toBeNull();
  });
});
