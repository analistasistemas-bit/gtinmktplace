// ADR-0180: pack real 2000014948061807 (Avil, 09/09/2026). 2 orders de R$ 66,40, comissão 7,67 cada,
// envio compartilhado de R$ 18,30, cupom do vendedor de R$ 2,50 por order (coupon_fee do MP),
// alíquota 16%, custo 26,00 por item. O ML mostra R$ 127,80; antes o PubliAI mostrava R$ 132,80.
import { describe, it, expect } from 'vitest';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import { cascataDoPedido } from '@/lib/cascata-pedido';
import { calcularResumo } from '@/lib/resumo-vendas';
import { calcularKpis, type Venda, type VendaItem } from '@/lib/faturamento';

function item(id: string): VendaItem {
  return {
    id, ml_item_id: `MLB${id}`, variation_id: null, titulo: 'Tecido Oxford', codigo: id, cor: null,
    ean: null, quantity: 1, unit_price: 66.4, sale_fee: 7.67, is_publiai: true, cupom_vendedor: 2.5,
  };
}
function venda(id: string, orderId: number): Venda {
  return {
    id, order_id: orderId, pack_id: 2000014948061807, status: 'paid', status_detail: null,
    date_closed: '2026-09-09T17:24:11Z', date_created: null, comprador_nick: 'ELOINACASAS_Z',
    comprador_id: 268227446, total_amount: 66.4, paid_amount: 66.4, sale_fee_total: 7.67,
    frete_vendedor: 18.3, liquido: 37.93, cupom_vendedor: 2.5, estorno: 0,
    money_release_date: '2026-09-26T11:50:57Z', currency: 'BRL', shipping_id: 47973149558,
    shipping_status: 'shipped', shipping_substatus: null, shipping_logistic: 'xd_drop_off',
    tracking_number: null, is_publiai: true, tem_devolucao: false, itens: [item(id)],
  } as Venda;
}
const vendas = () => [venda('a', 2000018370038668), venda('b', 2000018370040186)];
const custo = () => 26;
const aliquota = () => 16;

describe('cupom do vendedor — Faturamento (pedido + cascata)', () => {
  it('Venda 127,80 · Líquido após ML 94,16 · imposto 20,44 · lucro 21,72', () => {
    const [p] = agruparPorPedido(vendas(), custo, undefined, undefined, aliquota);
    expect(p.bruto).toBe(127.8);
    expect(p.brutoFaturavel).toBe(127.8);
    expect(p.imposto).toBe(20.44);
    const c = cascataDoPedido(p);
    expect(c.venda).toBe(127.8);
    expect(c.recebido).toBe(94.16);
    expect(c.ajustes).toBe(0);
    expect(c.margem).toBe(21.72);
    expect(c.aliquotaPct).toBe(16);
  });
});

describe('cupom do vendedor — Financeiro (calcularResumo)', () => {
  it('bruto, líquido, imposto e lucro sem o cupom', () => {
    const r = calcularResumo(vendas(), custo, undefined, Date.parse('2026-10-05'), aliquota);
    expect(r.bruto).toBe(127.8);
    expect(r.liquido).toBe(94.16);
    expect(r.imposto).toBe(20.44);
    expect(r.lucro).toBe(21.72);
    expect(r.comissao).toBe(15.34);
    expect(r.frete).toBe(18.3);
    expect(r.vendas.map((v) => v.bruto)).toEqual([63.9, 63.9]);
    expect(Object.values(r.porItem).map((x) => x.valor)).toEqual([63.9, 63.9]);
  });

  it('KPI de faturamento do menu Faturamento também desconta', () => {
    expect(calcularKpis(vendas()).faturamento).toBe(127.8);
  });
});

describe('cupom do vendedor — compatibilidade', () => {
  it('venda sem a coluna (null/undefined) continua igual', () => {
    const v = { ...venda('a', 1), pack_id: null, shipping_id: null, cupom_vendedor: null, liquido: 40.43,
      itens: [{ ...item('a'), cupom_vendedor: undefined }] } as unknown as Venda;
    const r = calcularResumo([v], custo, undefined, Date.parse('2026-10-05'), aliquota);
    expect(r.bruto).toBe(66.4);
    expect(r.imposto).toBe(10.62);
  });
});
