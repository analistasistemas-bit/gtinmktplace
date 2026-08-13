// Registrar saque é ação em massa sobre dinheiro: com "selecionar todos" numa página cheia, um
// clique marcava dezenas de pedidos sem confirmação (code-review-v11, M1).
import { describe, it, expect } from 'vitest';
import { resumoSelecaoSaque, LIMITE_CONFIRMA_SAQUE } from '@/lib/saque-selecao';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
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
    estorno: null, money_release_date: '2026-08-01T00:00:00Z', sacado_em: null, sacado_por: null,
    atualizado_em: '2026-08-01T00:00:00Z', currency: 'BRL', shipping_id: null,
    shipping_status: null, shipping_substatus: null, shipping_logistic: null,
    tracking_number: null, is_publiai: true, tem_devolucao: false, itens: [item()], ...over,
  } as Venda;
}

const pedidosDe = (n: number) =>
  agruparPorPedido(Array.from({ length: n }, (_, i) => venda({ id: `v${i}`, order_id: i + 1 })));

describe('resumoSelecaoSaque', () => {
  it('soma quantidade e valor líquido da seleção', () => {
    const r = resumoSelecaoSaque(pedidosDe(3));
    expect(r.quantidade).toBe(3);
    expect(r.valor).toBe(270); // 3 × 90
  });

  it('não pede confirmação numa seleção pequena', () => {
    expect(resumoSelecaoSaque(pedidosDe(1)).precisaConfirmar).toBe(false);
    expect(resumoSelecaoSaque(pedidosDe(LIMITE_CONFIRMA_SAQUE)).precisaConfirmar).toBe(false);
  });

  it('pede confirmação ao passar do limite', () => {
    expect(resumoSelecaoSaque(pedidosDe(LIMITE_CONFIRMA_SAQUE + 1)).precisaConfirmar).toBe(true);
  });

  it('seleção vazia não pede confirmação e soma zero', () => {
    expect(resumoSelecaoSaque([])).toEqual({ quantidade: 0, valor: 0, precisaConfirmar: false });
  });

  it('usa o líquido com imposto (o mesmo número que a coluna Líquido mostra)', () => {
    // p.liquido é líquido DE imposto; a tela exibe p.liquido + p.imposto, e a confirmação precisa
    // falar a mesma língua da coluna que o operador está lendo.
    const pedidos = agruparPorPedido([venda({ id: 'a', order_id: 1, liquido: 90 })]);
    expect(resumoSelecaoSaque(pedidos).valor).toBe(pedidos[0].liquido + pedidos[0].imposto);
  });
});
