import { describe, it, expect } from 'vitest';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import type { Venda, VendaItem } from '@/lib/faturamento';
import type { CustoResolver } from '@/lib/resumo-vendas';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return {
    id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'FITA CETIM',
    codigo: '001', cor: null, ean: '789', quantity: 1, unit_price: 10,
    sale_fee: 0, is_publiai: true, ...over,
  };
}
function venda(over: Partial<Venda> = {}): Venda {
  return {
    id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-06-15T00:00:00Z', date_created: null, comprador_nick: 'cliente',
    comprador_id: 100, total_amount: 10, paid_amount: 10, sale_fee_total: 1,
    frete_vendedor: null, liquido: 9, estorno: null, money_release_date: null,
    currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
    shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, itens: [item()], ...over,
  };
}

describe('agruparPorPedido', () => {
  it('agrupa orders do mesmo pack numa linha (frete uma vez, valores somados)', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 50, shipping_id: 99, total_amount: 12.5, liquido: 11, frete_vendedor: 40.4,
        itens: [item({ id: 'i1', titulo: 'A', unit_price: 12.5, quantity: 1 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 50, shipping_id: 99, total_amount: 37.9, liquido: 31.46, frete_vendedor: 40.4,
        itens: [item({ id: 'i2', titulo: 'B', unit_price: 37.9, quantity: 1 })] }),
    ];
    const pedidos = agruparPorPedido(vendas);
    expect(pedidos).toHaveLength(1);
    const p = pedidos[0];
    expect(p.isPack).toBe(true);
    expect(p.orderIds).toEqual([1, 2]);
    expect(p.bruto).toBe(50.4);          // 12.5 + 37.9
    expect(p.frete).toBe(40.4);          // uma vez, não 80.8
    expect(p.liquido).toBe(8);           // bruto 50.4 − comissão 2 − frete 40.4 (ADR-0042)
    expect(p.unidades).toBe(2);
    expect(p.itens).toHaveLength(2);
  });

  it('pedido sem pack vira 1 linha (chave = order_id)', () => {
    const pedidos = agruparPorPedido([venda({ id: 'a', order_id: 7, pack_id: null })]);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].isPack).toBe(false);
    expect(pedidos[0].chave).toBe('7');
  });

  it('markup do pedido e por produto usando custo (rateio do líquido por valor)', () => {
    const custo: CustoResolver = (it) => (it.id === 'i1' ? 5 : 10); // custo unitário
    const vendas = [venda({
      id: 'a', order_id: 1, pack_id: null, total_amount: 30, liquido: 24,
      itens: [
        item({ id: 'i1', titulo: 'A', unit_price: 10, quantity: 1 }),   // valor 10
        item({ id: 'i2', titulo: 'B', unit_price: 20, quantity: 1 }),   // valor 20
      ],
    })];
    const p = agruparPorPedido(vendas, custo)[0];
    expect(p.custo).toBe(15);                 // 5 + 10
    // markup do pedido = (24 - 15)/15 = 0.6
    expect(p.markup).toBeCloseTo(0.6, 5);
    // líquido rateado por valor: i1 = 24*10/30 = 8 ; i2 = 24*20/30 = 16
    const i1 = p.itens.find((x) => x.id === 'i1')!;
    const i2 = p.itens.find((x) => x.id === 'i2')!;
    expect(i1.liquido).toBe(8);
    expect(i2.liquido).toBe(16);
    expect(i1.markup).toBeCloseTo((8 - 5) / 5, 5);   // 0.6
    expect(i2.markup).toBeCloseTo((16 - 10) / 10, 5); // 0.6
  });

  it('sem custo cadastrado → markup null', () => {
    const p = agruparPorPedido([venda({ id: 'a' })])[0];
    expect(p.custo).toBeNull();
    expect(p.markup).toBeNull();
    expect(p.itens[0].markup).toBeNull();
  });
});

import { calcularKpisPedidos } from '@/lib/pedidos-faturamento';

describe('calcularKpisPedidos', () => {
  it('conta pedidos reais (packs), ticket e itens por pedido sobre faturáveis', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 50, total_amount: 12.5, shipping_status: 'ready_to_ship',
        itens: [item({ id: 'i1', quantity: 1 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 50, total_amount: 37.5, shipping_status: 'ready_to_ship',
        itens: [item({ id: 'i2', quantity: 1 })] }),
      venda({ id: 'c', order_id: 3, pack_id: null, total_amount: 50, shipping_status: 'shipped',
        comprador_id: 200, itens: [item({ id: 'i3', quantity: 2 })] }),
    ];
    const k = calcularKpisPedidos(agruparPorPedido(vendas));
    expect(k.pedidos).toBe(2);             // 1 pack + 1 solo
    expect(k.unidades).toBe(4);            // 1 + 1 + 2
    expect(k.ticket).toBe(50);            // (50 + 50) / 2
    expect(k.itensPorPedido).toBe(2);     // 4 / 2
    expect(k.compradoresUnicos).toBe(2);  // comprador 100 e 200
  });

  it('cancelado fica fora dos KPIs monetários mas conta no status de envio', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: null, total_amount: 50, shipping_status: 'shipped' }),
      venda({ id: 'b', order_id: 2, pack_id: null, status: 'cancelled', total_amount: 999, shipping_status: 'pending' }),
    ];
    const k = calcularKpisPedidos(agruparPorPedido(vendas));
    expect(k.pedidos).toBe(1);
    expect(Object.values(k.porStatusEnvio).reduce((a, b) => a + b, 0)).toBe(2); // conta os 2 pedidos
  });

  it('pctRecompra = % dos pedidos de compradores com mais de 1 pedido no período', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: null, comprador_id: 100 }),
      venda({ id: 'b', order_id: 2, pack_id: null, comprador_id: 100 }),
      venda({ id: 'c', order_id: 3, pack_id: null, comprador_id: 200 }),
    ];
    const k = calcularKpisPedidos(agruparPorPedido(vendas));
    // comprador 100 tem 2 pedidos (recorrente) → 2 de 3 pedidos = 66.7%
    expect(k.pctRecompra).toBeCloseTo((2 / 3) * 100, 1);
  });
});
