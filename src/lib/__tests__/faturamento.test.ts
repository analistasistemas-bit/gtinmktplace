import { describe, it, expect } from 'vitest';
import { calcularKpis, type Venda } from '../faturamento';

const venda = (over: Partial<Venda>): Venda => ({
  id: 'x', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-20T00:00:00Z', date_created: '2026-06-20T00:00:00Z',
  comprador_nick: null, total_amount: 0, paid_amount: null, sale_fee_total: 0,
  frete_vendedor: null, liquido: null, currency: 'BRL', shipping_status: null,
  shipping_substatus: null, tracking_number: null, is_publiai: false, tem_devolucao: false,
  itens: [], ...over,
});

describe('calcularKpis', () => {
  it('agrega faturamento, líquido, unidades, pedidos e ticket', () => {
    const k = calcularKpis([
      venda({ total_amount: 90.2, liquido: 83, itens: [{ id: 'a', ml_item_id: 'M', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 2, unit_price: 45.1, sale_fee: 7.2, is_publiai: true }] }),
      venda({ total_amount: 10, liquido: 9, itens: [{ id: 'b', ml_item_id: 'N', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 1, unit_price: 10, sale_fee: 1, is_publiai: false }] }),
    ]);
    expect(k.faturamento).toBe(100.2);
    expect(k.liquido).toBe(92);
    expect(k.unidades).toBe(3);
    expect(k.pedidos).toBe(2);
    expect(k.ticket).toBe(50.1);
  });
  it('ignora pedidos não pagos (cancelado) no faturamento', () => {
    const k = calcularKpis([
      venda({ status: 'paid', total_amount: 50, liquido: 45, itens: [{ id: 'a', ml_item_id: 'M', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 1, unit_price: 50, sale_fee: 5, is_publiai: true }] }),
      venda({ status: 'cancelled', total_amount: 999, liquido: 900, itens: [{ id: 'b', ml_item_id: 'N', variation_id: null, titulo: 't', codigo: null, cor: null, ean: null, quantity: 9, unit_price: 111, sale_fee: 99, is_publiai: false }] }),
    ]);
    expect(k.faturamento).toBe(50);
    expect(k.pedidos).toBe(1);
    expect(k.unidades).toBe(1);
  });
  it('vazio → zeros e ticket 0', () => {
    expect(calcularKpis([])).toEqual({ faturamento: 0, liquido: 0, unidades: 0, pedidos: 0, ticket: 0 });
  });
});
