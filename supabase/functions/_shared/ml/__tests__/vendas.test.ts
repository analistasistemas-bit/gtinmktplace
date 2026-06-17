import { describe, it, expect } from 'vitest';
import { agregarPedidos, type PedidoML } from '../vendas.ts';

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

  it('ignora itens fora do escopo', () => {
    const pedidos: PedidoML[] = [
      { id: 1, order_items: [
        { item: { id: 'MLB1' }, quantity: 1, unit_price: 10 },
        { item: { id: 'FORA' }, quantity: 9, unit_price: 99 },
      ] },
    ];
    const r = agregarPedidos(pedidos, escopo);
    expect(r.porItem['FORA']).toBeUndefined();
    expect(r.totais).toEqual({ faturamento: 10, unidades: 1, pedidos: 1 });
  });

  it('conta um pedido uma vez mesmo tocando vários itens do escopo', () => {
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

  it('não conta pedido que não tocou nenhum item do escopo', () => {
    const pedidos: PedidoML[] = [
      { id: 1, order_items: [{ item: { id: 'FORA' }, quantity: 5, unit_price: 5 }] },
    ];
    const r = agregarPedidos(pedidos, escopo);
    expect(r.totais).toEqual({ faturamento: 0, unidades: 0, pedidos: 0 });
    expect(r.porItem).toEqual({});
  });

  it('tolera campos ausentes/nulos', () => {
    const pedidos: PedidoML[] = [
      { id: 1, order_items: null },
      { id: 2, order_items: [{ item: null, quantity: 1, unit_price: 1 }] },
      { id: 3, order_items: [{ item: { id: 'MLB1' }, quantity: null, unit_price: null }] },
    ];
    const r = agregarPedidos(pedidos, escopo);
    expect(r.porItem['MLB1']).toEqual({ unidades: 0, valor: 0 });
    expect(r.totais.pedidos).toBe(1);
  });
});
