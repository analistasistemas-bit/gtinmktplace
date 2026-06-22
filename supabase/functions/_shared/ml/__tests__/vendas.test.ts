import { describe, it, expect } from 'vitest';
import { agregarPedidos, montarExternos, reclassificarPorGtin, extrairGtin, type PedidoML } from '../vendas.ts';

// Semântica (ADR-0032): `totais` reflete TODA a conta do vendedor no período (bate com a
// tela de Métricas do ML), enquanto `porItem` continua restrito ao escopo do app (tabela,
// rankings e encalhados na tela Publicados).
describe('agregarPedidos', () => {
  const escopo = new Set(['MLB1', 'MLB2']);

  it('soma unidades e valor por item dentro do escopo', () => {
    const pedidos: PedidoML[] = [
      { id: 1, order_items: [{ item: { id: 'MLB1' }, quantity: 2, unit_price: 10 }] },
      { id: 2, order_items: [{ item: { id: 'MLB1' }, quantity: 3, unit_price: 10 }] },
      { id: 3, order_items: [{ item: { id: 'MLB2' }, quantity: 1, unit_price: 25 }] },
    ];
    const r = agregarPedidos(pedidos, escopo);
    expect(r.porItem['MLB1']).toEqual({ unidades: 5, valor: 50 });
    expect(r.porItem['MLB2']).toEqual({ unidades: 1, valor: 25 });
    expect(r.totais).toEqual({ faturamento: 75, unidades: 6, pedidos: 3 });
  });

  it('porItem ignora itens fora do escopo, mas os totais contam a conta inteira', () => {
    const pedidos: PedidoML[] = [
      { id: 1, order_items: [
        { item: { id: 'MLB1' }, quantity: 1, unit_price: 10 },
        { item: { id: 'FORA' }, quantity: 9, unit_price: 99 },
      ] },
    ];
    const r = agregarPedidos(pedidos, escopo);
    expect(r.porItem['MLB1']).toEqual({ unidades: 1, valor: 10 });
    expect(r.porItem['FORA']).toBeUndefined();
    // totais globais: 1×10 + 9×99 = 901; 1 + 9 = 10 unidades; 1 pedido.
    expect(r.totais).toEqual({ faturamento: 901, unidades: 10, pedidos: 1 });
  });

  it('conta um pedido uma vez mesmo tocando vários itens', () => {
    const pedidos: PedidoML[] = [
      { id: 1, order_items: [
        { item: { id: 'MLB1' }, quantity: 1, unit_price: 10 },
        { item: { id: 'MLB2' }, quantity: 1, unit_price: 20 },
      ] },
    ];
    const r = agregarPedidos(pedidos, escopo);
    expect(r.totais.pedidos).toBe(1);
    expect(r.totais.faturamento).toBe(30);
  });

  it('conta nos totais um pedido mesmo que nenhum item esteja no escopo (porItem fica vazio)', () => {
    const pedidos: PedidoML[] = [
      { id: 1, order_items: [{ item: { id: 'FORA' }, quantity: 5, unit_price: 5 }] },
    ];
    const r = agregarPedidos(pedidos, escopo);
    expect(r.totais).toEqual({ faturamento: 25, unidades: 5, pedidos: 1 });
    expect(r.porItem).toEqual({});
  });

  it('separa itens fora do escopo em porItemExterno sem poluir porItem', () => {
    const pedidos: PedidoML[] = [
      { id: 1, order_items: [
        { item: { id: 'MLB1' }, quantity: 1, unit_price: 10 },
        { item: { id: 'FORA' }, quantity: 2, unit_price: 50 },
      ] },
      { id: 2, order_items: [{ item: { id: 'FORA' }, quantity: 1, unit_price: 50 }] },
    ];
    const r = agregarPedidos(pedidos, escopo);
    expect(r.porItem['MLB1']).toEqual({ unidades: 1, valor: 10 });
    expect(r.porItem['FORA']).toBeUndefined();
    expect(r.porItemExterno['FORA']).toEqual({ unidades: 3, valor: 150 });
    expect(r.totais).toEqual({ faturamento: 160, unidades: 4, pedidos: 2 });
  });

  it('tolera campos ausentes/nulos', () => {
    const pedidos: PedidoML[] = [
      { id: 1, order_items: null },
      { id: 2, order_items: [{ item: null, quantity: 1, unit_price: 1 }] },
      { id: 3, order_items: [{ item: { id: 'MLB1' }, quantity: null, unit_price: null }] },
    ];
    const r = agregarPedidos(pedidos, escopo);
    expect(r.porItem['MLB1']).toEqual({ unidades: 0, valor: 0 });
    // pedido 1 sem itens não conta; pedidos 2 e 3 contam.
    expect(r.totais).toEqual({ faturamento: 1, unidades: 1, pedidos: 2 });
  });
});

describe('reclassificarPorGtin', () => {
  // mapaGtin: GTIN do produto do usuário → ml_item_id da família dona dele.
  const mapaGtin = { '789001': 'MLB_MEU_1', '789002': 'MLB_MEU_2' };

  it('move item externo cujo GTIN casa para porItem sob o ml_item_id do usuário', () => {
    const porItem = {};
    const porItemExterno = { MLB_CAT: { unidades: 3, valor: 90 } };
    const gtinPorItem = { MLB_CAT: '789001' };
    const r = reclassificarPorGtin(porItem, porItemExterno, gtinPorItem, mapaGtin);
    expect(r.porItem['MLB_MEU_1']).toEqual({ unidades: 3, valor: 90 });
    expect(r.porItemExterno['MLB_CAT']).toBeUndefined();
  });

  it('soma a venda de catálogo sobre a venda direta já existente do mesmo produto', () => {
    const porItem = { MLB_MEU_1: { unidades: 2, valor: 40 } };
    const porItemExterno = { MLB_CAT: { unidades: 3, valor: 90 } };
    const gtinPorItem = { MLB_CAT: '789001' };
    const r = reclassificarPorGtin(porItem, porItemExterno, gtinPorItem, mapaGtin);
    expect(r.porItem['MLB_MEU_1']).toEqual({ unidades: 5, valor: 130 });
    expect(r.porItemExterno).toEqual({});
  });

  it('mantém externo o item cujo GTIN não casa', () => {
    const porItem = {};
    const porItemExterno = { MLB_OUTRO: { unidades: 1, valor: 50 } };
    const gtinPorItem = { MLB_OUTRO: '000999' };
    const r = reclassificarPorGtin(porItem, porItemExterno, gtinPorItem, mapaGtin);
    expect(r.porItem).toEqual({});
    expect(r.porItemExterno['MLB_OUTRO']).toEqual({ unidades: 1, valor: 50 });
  });

  it('mantém externo o item sem GTIN conhecido (API não trouxe)', () => {
    const porItem = {};
    const porItemExterno = { MLB_SEM_GTIN: { unidades: 1, valor: 10 } };
    const gtinPorItem = {};
    const r = reclassificarPorGtin(porItem, porItemExterno, gtinPorItem, mapaGtin);
    expect(r.porItemExterno['MLB_SEM_GTIN']).toEqual({ unidades: 1, valor: 10 });
    expect(r.porItem).toEqual({});
  });

  it('soma dois itens externos com o mesmo GTIN no mesmo ml_item_id', () => {
    const porItem = {};
    const porItemExterno = {
      MLB_CAT_A: { unidades: 1, valor: 30 },
      MLB_CAT_B: { unidades: 2, valor: 60 },
    };
    const gtinPorItem = { MLB_CAT_A: '789002', MLB_CAT_B: '789002' };
    const r = reclassificarPorGtin(porItem, porItemExterno, gtinPorItem, mapaGtin);
    expect(r.porItem['MLB_MEU_2']).toEqual({ unidades: 3, valor: 90 });
    expect(r.porItemExterno).toEqual({});
  });

  it('não muta os objetos de entrada', () => {
    const porItem = { MLB_MEU_1: { unidades: 2, valor: 40 } };
    const porItemExterno = { MLB_CAT: { unidades: 3, valor: 90 } };
    reclassificarPorGtin(porItem, porItemExterno, { MLB_CAT: '789001' }, mapaGtin);
    expect(porItem).toEqual({ MLB_MEU_1: { unidades: 2, valor: 40 } });
    expect(porItemExterno).toEqual({ MLB_CAT: { unidades: 3, valor: 90 } });
  });
});

describe('extrairGtin', () => {
  it('lê o atributo de id GTIN', () => {
    const attrs = [{ id: 'BRAND', value_name: 'X' }, { id: 'GTIN', value_name: '789001' }];
    expect(extrairGtin(attrs)).toBe('789001');
  });

  it('usa EAN como fallback quando não há GTIN', () => {
    const attrs = [{ id: 'EAN', value_name: '789002' }];
    expect(extrairGtin(attrs)).toBe('789002');
  });

  it('retorna undefined quando não há GTIN nem EAN', () => {
    expect(extrairGtin([{ id: 'BRAND', value_name: 'X' }])).toBeUndefined();
    expect(extrairGtin(undefined)).toBeUndefined();
    expect(extrairGtin([{ id: 'GTIN', value_name: null }])).toBeUndefined();
  });
});

describe('montarExternos', () => {
  it('mapeia título por id e ordena por valor desc; usa id quando falta título', () => {
    const porItemExterno = {
      MLBX: { unidades: 5, valor: 62.5 },
      MLBY: { unidades: 2, valor: 100 },
    };
    const titulos = { MLBY: 'Produto Y' };
    const r = montarExternos(porItemExterno, titulos);
    expect(r).toEqual([
      { id: 'MLBY', titulo: 'Produto Y', unidades: 2, valor: 100 },
      { id: 'MLBX', titulo: 'MLBX', unidades: 5, valor: 62.5 },
    ]);
  });
});
