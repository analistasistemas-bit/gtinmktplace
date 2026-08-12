import { describe, it, expect } from 'vitest';
import { agruparPorPedido } from '../pedidos-faturamento';
import type { AliquotaResolver } from '../resumo-vendas';
import type { Venda, VendaItem } from '../faturamento';

const item = (over: Partial<VendaItem>): VendaItem => ({
  id: 'i', ml_item_id: 'X', variation_id: null, titulo: 't', codigo: null, cor: null,
  ean: null, quantity: 1, unit_price: 44.55, sale_fee: 0, is_publiai: true, ...over,
});
const venda = (over: Partial<Venda>): Venda => ({
  id: 'x', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-20T00:00:00Z', date_created: '2026-06-20T00:00:00Z',
  comprador_id: null, comprador_nick: null, comprador_nome: null, total_amount: 44.55, paid_amount: null,
  sale_fee_total: 0, frete_vendedor: null, liquido: 40, estorno: null, money_release_date: null,
  sacado_em: null, sacado_por: null,
  currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
  shipping_logistic: null, tracking_number: null, is_publiai: false, tem_devolucao: false,
  uf: null, cidade: null, itens: [], atualizado_em: '2026-06-20T00:00:00Z', ...over,
});

// Nacional 8% / importado 16% (ADR-0055), com 1% dentro de PE (ADR-0112). Y é importado.
const aliquotas: AliquotaResolver = (it, uf) =>
  (uf?.toUpperCase() === 'PE' ? 1 : it.ml_item_id === 'Y' ? 16 : 8);

describe('agruparPorPedido — alíquota por item (ADR-0055)', () => {
  it('carrega a alíquota crua do resolver, não a reconstrói do imposto arredondado', () => {
    // 44,55 × 8% = 3,564 → imposto gravado 3,56. Derivar de volta daria 7,99%.
    const [p] = agruparPorPedido([venda({ itens: [item({})] })], undefined, undefined, undefined, aliquotas);
    expect(p.itens[0].imposto).toBe(3.56);
    expect(p.itens[0].aliquotaPct).toBe(8);
  });

  it('distingue as alíquotas de itens de origens diferentes no mesmo pedido', () => {
    const [p] = agruparPorPedido(
      [venda({ itens: [item({ id: 'a', ml_item_id: 'X' }), item({ id: 'b', ml_item_id: 'Y' })] })],
      undefined, undefined, undefined, aliquotas,
    );
    expect(p.itens.map((i) => i.aliquotaPct)).toEqual([8, 16]);
  });

  it('deixa a alíquota nula quando não há resolver (sem imposto)', () => {
    const [p] = agruparPorPedido([venda({ itens: [item({})] })]);
    expect(p.itens[0].imposto).toBe(0);
    expect(p.itens[0].aliquotaPct).toBeNull();
  });

  it('deixa a alíquota nula em venda cancelada (não faturável)', () => {
    const [p] = agruparPorPedido(
      [venda({ status: 'cancelled', itens: [item({})] })], undefined, undefined, undefined, aliquotas,
    );
    expect(p.itens[0].imposto).toBe(0);
    expect(p.itens[0].aliquotaPct).toBeNull();
  });

  it('usa a alíquota interna no pedido entregue na UF da empresa (ADR-0112)', () => {
    // 44,55 × 1% = 0,4455 → 0,45 (em vez de 3,56 pela origem nacional).
    const [p] = agruparPorPedido(
      [venda({ uf: 'PE', itens: [item({})] })], undefined, undefined, undefined, aliquotas,
    );
    expect(p.itens[0].imposto).toBe(0.45);
    expect(p.itens[0].aliquotaPct).toBe(1);
  });
});
