import { describe, it, expect } from 'vitest';
import { calcularResumo, fretePorPedidoRateado, ehFaturavel } from '@/lib/resumo-vendas';
import type { Venda, VendaItem } from '@/lib/faturamento';

const round2 = (n: number) => Math.round(n * 100) / 100;

const item = (over: Partial<VendaItem> = {}): VendaItem => ({
  id: 'i', ml_item_id: 'MLB1', variation_id: null, titulo: 't', codigo: null, cor: null,
  ean: null, quantity: 1, unit_price: 10, sale_fee: 1, is_publiai: true, ...over,
});

const venda = (over: Partial<Venda> = {}): Venda => ({
  id: 'x', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-20T00:00:00Z', date_created: '2026-06-20T00:00:00Z',
  comprador_nick: null, total_amount: 10, paid_amount: null, sale_fee_total: 1,
  frete_vendedor: null, liquido: 9, estorno: null, money_release_date: null,
  currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
  shipping_logistic: null, tracking_number: null, is_publiai: false, tem_devolucao: false,
  itens: [item()], ...over,
});

describe('ehFaturavel', () => {
  it('paid, partially_refunded e refunded são faturáveis; cancelled não', () => {
    expect(ehFaturavel('paid')).toBe(true);
    expect(ehFaturavel('partially_refunded')).toBe(true);
    expect(ehFaturavel('refunded')).toBe(true);
    expect(ehFaturavel('cancelled')).toBe(false);
    expect(ehFaturavel(null)).toBe(false);
  });
});

describe('calcularResumo', () => {
  it('inclui reembolso parcial no bruto (igual ML) e exclui cancelado', () => {
    const r = calcularResumo([
      venda({ id: 'a', order_id: 1, status: 'paid', total_amount: 776.83, liquido: 459.62,
        itens: [item({ id: 'a1', quantity: 46, unit_price: 776.83 / 46 })] }),
      venda({ id: 'b', order_id: 2, status: 'partially_refunded', total_amount: 25, liquido: 9.58,
        itens: [item({ id: 'b1', ml_item_id: 'MLB2', quantity: 2, unit_price: 12.5 })] }),
      venda({ id: 'c', order_id: 3, status: 'cancelled', total_amount: 999, liquido: 0,
        itens: [item({ id: 'c1', quantity: 9, unit_price: 111 })] }),
    ]);
    expect(r.bruto).toBe(801.83);   // 776,83 + 25  (cancelado fora)
    expect(r.pedidos).toBe(2);
    expect(r.unidades).toBe(48);    // 46 + 2
    expect(r.liquido).toBe(469.2);  // 459,62 + 9,58
    expect(r.descontos).toBe(round2(801.83 - 469.2));
  });

  it('soma estornos do campo estorno', () => {
    const r = calcularResumo([
      venda({ id: 'a', status: 'partially_refunded', total_amount: 25, liquido: 9.58, estorno: 12.5 }),
      venda({ id: 'b', status: 'paid', total_amount: 10, liquido: 9, estorno: null }),
    ]);
    expect(r.estornos).toBe(12.5);
  });

  it('agrega porItem por ml_item_id (valor = unit_price × qtd)', () => {
    const r = calcularResumo([
      venda({ id: 'a', itens: [item({ ml_item_id: 'MLB1', quantity: 2, unit_price: 10 })] }),
      venda({ id: 'b', itens: [item({ ml_item_id: 'MLB1', quantity: 1, unit_price: 10 })] }),
      venda({ id: 'c', itens: [item({ ml_item_id: 'MLB2', quantity: 3, unit_price: 5 })] }),
    ]);
    expect(r.porItem['MLB1']).toEqual({ unidades: 3, valor: 30 });
    expect(r.porItem['MLB2']).toEqual({ unidades: 3, valor: 15 });
  });

  it('markup só sobre vendas com custo; ticket = bruto/pedidos', () => {
    const resolver = (it: VendaItem) => (it.ml_item_id === 'COM' ? 4 : null);
    const r = calcularResumo([
      venda({ id: 'a', total_amount: 20, liquido: 16, itens: [item({ ml_item_id: 'COM', quantity: 2, unit_price: 10 })] }),
      venda({ id: 'b', total_amount: 50, liquido: 40, itens: [item({ ml_item_id: 'SEM', quantity: 1, unit_price: 50 })] }),
    ], resolver);
    expect(r.markup).toBeCloseTo(1.0, 5); // (16 - 8) / 8
    expect(r.lucro).toBe(8);
    expect(r.ticket).toBe(35); // (20 + 50) / 2
  });

  it('vazio → zeros e markup null', () => {
    const r = calcularResumo([]);
    expect(r).toMatchObject({ bruto: 0, liquido: 0, descontos: 0, estornos: 0, pedidos: 0, unidades: 0, ticket: 0, markup: null });
  });
});

describe('fretePorPedidoRateado', () => {
  it('divide o frete do envio igualmente entre os pedidos do pack', () => {
    const m = fretePorPedidoRateado([
      venda({ order_id: 1, shipping_id: 99, frete_vendedor: 40.4 }),
      venda({ order_id: 2, shipping_id: 99, frete_vendedor: 40.4 }),
      venda({ order_id: 3, shipping_id: 99, frete_vendedor: 40.4 }),
      venda({ order_id: 4, shipping_id: null, pack_id: null, frete_vendedor: 6.55 }),
    ]);
    expect(m.get(1)).toBeCloseTo(13.47, 2); // 40,40 / 3
    expect(m.get(4)).toBe(6.55);
    expect((m.get(1)! + m.get(2)! + m.get(3)!)).toBeCloseTo(40.4, 1);
  });
});
