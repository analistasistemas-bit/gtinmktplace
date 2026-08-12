// O Detalhe do líquido é uma tela de RECEBIMENTO: pedido sem dinheiro a receber (cancelado,
// devolvido) fica fora da lista por padrão. O que não está na lista não pode ser selecionado nem
// sacado — a trava vira estrutural em vez de depender de o operador não clicar (code-review-v11).
import { describe, it, expect } from 'vitest';
import { agruparPorPedido, filtrarPedidosFinanceiro, totaisFinanceiro } from '@/lib/pedidos-faturamento';
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
const AGORA = Date.parse('2026-08-12T00:00:00Z');

const PAGA_LIBERADA = venda({ id: 'a', order_id: 1, money_release_date: PASSADO });
const DEVOLVIDA = venda({
  id: 'b', order_id: 2, status: 'cancelled', total_amount: 384.8, liquido: 289.68,
  estorno: 384.8, tem_devolucao: true, money_release_date: PASSADO,
  itens: [item({ id: 'i2', unit_price: 384.8 })],
});

describe('filtrarPedidosFinanceiro', () => {
  it('"todos" mostra só venda faturável — a devolvida fica fora', () => {
    const pedidos = agruparPorPedido([PAGA_LIBERADA, DEVOLVIDA]);
    const visiveis = filtrarPedidosFinanceiro(pedidos, 'todos', AGORA);
    expect(visiveis).toHaveLength(1);
    expect(visiveis[0].orderIds).toEqual([1]);
  });

  it('"devolvidos" mostra exclusivamente o que não é faturável', () => {
    const pedidos = agruparPorPedido([PAGA_LIBERADA, DEVOLVIDA]);
    const visiveis = filtrarPedidosFinanceiro(pedidos, 'devolvidos', AGORA);
    expect(visiveis).toHaveLength(1);
    expect(visiveis[0].orderIds).toEqual([2]);
  });

  it('"liberado" nunca traz devolvida, mesmo com data de liberação no passado', () => {
    const pedidos = agruparPorPedido([PAGA_LIBERADA, DEVOLVIDA]);
    const visiveis = filtrarPedidosFinanceiro(pedidos, 'liberado', AGORA);
    expect(visiveis).toHaveLength(1);
    expect(visiveis[0].orderIds).toEqual([1]);
  });

  it('"sacado" traz só o que foi marcado como sacado', () => {
    const pedidos = agruparPorPedido([
      PAGA_LIBERADA,
      venda({ id: 'c', order_id: 3, money_release_date: PASSADO, sacado_em: '2026-08-05T00:00:00Z' }),
    ]);
    expect(filtrarPedidosFinanceiro(pedidos, 'sacado', AGORA).map((p) => p.orderIds)).toEqual([[3]]);
  });

  it('pack misto (uma order cancelada, outra paga) continua visível — tem dinheiro a receber', () => {
    const pedidos = agruparPorPedido([
      venda({ id: 'x', order_id: 10, pack_id: 99, shipping_id: 99, status: 'cancelled', total_amount: 16, liquido: 14 }),
      venda({ id: 'y', order_id: 11, pack_id: 99, shipping_id: 99, total_amount: 40, liquido: 33 }),
    ]);
    expect(filtrarPedidosFinanceiro(pedidos, 'todos', AGORA)).toHaveLength(1);
    expect(filtrarPedidosFinanceiro(pedidos, 'devolvidos', AGORA)).toHaveLength(0);
  });
});

describe('totais sob paginação', () => {
  it('somam o filtro inteiro, não a página visível', () => {
    // 120 pedidos pagos de R$ 100 (líquido 90). Com página de 50, o rodapé precisa continuar
    // somando os 120 — senão o total mente para quem está na página 1.
    const vendas = Array.from({ length: 120 }, (_, i) => venda({
      id: `v${i}`, order_id: i + 1, money_release_date: PASSADO,
    }));
    const filtrados = filtrarPedidosFinanceiro(agruparPorPedido(vendas), 'todos', AGORA);
    const pagina = filtrados.slice(0, 50);

    expect(pagina).toHaveLength(50);
    expect(totaisFinanceiro(filtrados).bruto).toBe(12000);
    expect(totaisFinanceiro(filtrados).liquido).toBe(10800);
  });
});
