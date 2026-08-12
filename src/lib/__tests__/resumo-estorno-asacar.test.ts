// Dois KPIs do menu Financeiro que informavam número errado sobre dinheiro (code-review-v11):
// "Estornos" omitia as devoluções (que o ML fecha como `cancelled`) e "Já liberado" misturava o
// que já foi sacado com o que ainda está no saldo.
import { describe, it, expect } from 'vitest';
import { calcularResumo } from '@/lib/resumo-vendas';
import type { Venda, VendaItem } from '@/lib/faturamento';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return {
    id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'FITA', codigo: '001', cor: null,
    ean: '789', quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...over,
  };
}
function venda(over: Partial<Venda> = {}): Venda {
  return {
    id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-08-01T00:00:00Z', date_created: null, comprador_nick: 'c',
    comprador_nome: null, comprador_id: 1, uf: null, cidade: null,
    total_amount: 100, paid_amount: 100, sale_fee_total: 10, frete_vendedor: null, liquido: 90,
    estorno: null, money_release_date: null, sacado_em: null, sacado_por: null,
    atualizado_em: '2026-08-01T00:00:00Z', currency: 'BRL', shipping_id: null,
    shipping_status: null, shipping_substatus: null, shipping_logistic: null,
    tracking_number: null, is_publiai: true, tem_devolucao: false, itens: [item()], ...over,
  } as Venda;
}

const PASSADO = '2026-08-01T00:00:00Z';
const FUTURO = '2099-01-01T00:00:00Z';

describe('estornos', () => {
  it('soma estorno de pedido cancelado — devolução concluída vira cancelled no ML', () => {
    const r = calcularResumo([
      venda({ id: 'a', order_id: 1, estorno: 12.55 }),
      venda({
        id: 'b', order_id: 2, status: 'cancelled', total_amount: 384.8,
        estorno: 384.8, tem_devolucao: true,
      }),
    ]);
    expect(r.estornos).toBe(397.35);
    expect(r.bruto).toBe(100); // a cancelada segue fora do faturamento (ADR-0038)
  });

  it('sem estorno em lugar nenhum, o total é zero', () => {
    expect(calcularResumo([venda({ id: 'a' })]).estornos).toBe(0);
  });
});

describe('aSacar', () => {
  it('conta só o liberado que ainda não foi marcado como sacado', () => {
    const r = calcularResumo([
      venda({ id: 'a', order_id: 1, liquido: 90, money_release_date: PASSADO, sacado_em: '2026-08-05T00:00:00Z' }),
      venda({ id: 'b', order_id: 2, liquido: 50, money_release_date: PASSADO, sacado_em: null }),
      venda({ id: 'c', order_id: 3, liquido: 30, money_release_date: FUTURO, sacado_em: null }),
    ]);
    expect(r.liberado).toBe(140); // histórico do período: independe de saque
    expect(r.aSacar).toBe(50);    // o que dá para tirar hoje
    expect(r.aLiberar).toBe(30);
  });

  it('pedido cancelado não entra em aSacar mesmo com liberação no passado', () => {
    const r = calcularResumo([
      venda({
        id: 'a', order_id: 1, status: 'cancelled', liquido: 90,
        money_release_date: PASSADO, sacado_em: null, estorno: 100,
      }),
    ]);
    expect(r.aSacar).toBe(0);
    expect(r.estornos).toBe(100); // mas o estorno dele conta
  });

  it('tudo sacado deixa aSacar zerado sem mexer no liberado', () => {
    const r = calcularResumo([
      venda({ id: 'a', order_id: 1, liquido: 90, money_release_date: PASSADO, sacado_em: '2026-08-05T00:00:00Z' }),
    ]);
    expect(r.liberado).toBe(90);
    expect(r.aSacar).toBe(0);
  });
});
