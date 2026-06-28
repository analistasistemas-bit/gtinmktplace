import { describe, it, expect } from 'vitest';
import { calcularResumo, type CustoResolver } from '../resumo-vendas';
import { agruparPorPedido, calcularKpisPedidos } from '../pedidos-faturamento';
import type { Venda, VendaItem } from '../faturamento';

const item = (over: Partial<VendaItem>): VendaItem => ({
  id: 'i', ml_item_id: 'X', variation_id: null, titulo: 't', codigo: null, cor: null,
  ean: null, quantity: 1, unit_price: 100, sale_fee: 0, is_publiai: true, ...over,
});
const venda = (over: Partial<Venda>): Venda => ({
  id: 'x', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-20T00:00:00Z', date_created: '2026-06-20T00:00:00Z',
  comprador_id: null, comprador_nick: null, comprador_nome: null, total_amount: 0, paid_amount: null,
  sale_fee_total: 0, frete_vendedor: null, liquido: null, estorno: null, money_release_date: null,
  currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
  shipping_logistic: null, tracking_number: null, is_publiai: false, tem_devolucao: false,
  uf: null, cidade: null, itens: [], ...over,
});

// Resolver de custo unitário (R$): X tem custo 40, Y não tem.
const resolver: CustoResolver = (it) => (it.ml_item_id === 'X' ? 40 : null);

describe('calcularResumo — custo/markup por pack (alinhado ao Faturamento)', () => {
  // Pack com 2 pedidos: um item com custo (X), outro sem (Y). Antes (por linha) só o X entrava;
  // agora o pack inteiro conta (líquido 80+40), igual ao menu Faturamento.
  const v1 = venda({ id: 'a', order_id: 1, pack_id: 1, total_amount: 100, liquido: 80,
    itens: [item({ id: 'a1', ml_item_id: 'X', unit_price: 100 })] });
  const v2 = venda({ id: 'b', order_id: 2, pack_id: 1, total_amount: 50, liquido: 40,
    itens: [item({ id: 'b1', ml_item_id: 'Y', unit_price: 50 })] });

  it('conta 1 pedido (pack) e vendasComCusto ≤ pedidos', () => {
    const r = calcularResumo([v1, v2], resolver);
    expect(r.pedidos).toBe(1);
    expect(r.vendasComCusto).toBe(1);
    expect(r.vendasComCusto).toBeLessThanOrEqual(r.pedidos); // nunca mais "55/45"
  });

  it('markup/lucro por pack: usa o líquido inteiro do pack (120) sobre o custo (40)', () => {
    const r = calcularResumo([v1, v2], resolver);
    expect(r.markup).toBeCloseTo(2.0, 5); // (120 − 40) / 40
    expect(r.lucro).toBe(80); // 120 − 40
  });

  it('markup do resumo == markup do calcularKpisPedidos (Faturamento)', () => {
    const r = calcularResumo([v1, v2], resolver);
    const kp = calcularKpisPedidos(agruparPorPedido([v1, v2], resolver));
    expect(r.markup).toBeCloseTo(kp.markup as number, 6);
    expect(r.pedidos).toBe(kp.pedidos);
  });
});
