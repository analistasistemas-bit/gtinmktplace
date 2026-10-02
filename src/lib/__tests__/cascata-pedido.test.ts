import { describe, expect, it } from 'vitest';
import { cascataDoPedido } from '../cascata-pedido';
import type { ItemPedido, Pedido } from '../pedidos-faturamento';

function item(o: Partial<ItemPedido> = {}): ItemPedido {
  return {
    id: 'i1', ml_item_id: null, titulo: 'Produto', codigo: null, cor: null, ean: null,
    quantity: 1, unit_price: 39.9, imagem_path: null, custo: 11.55, liquido: 21.78,
    imposto: 6.38, aliquotaPct: 16, markup: 0.886, faturavel: true, estorno: 0,
    custoEstimado: false, temDevolucao: false, orderId: 1, uf: null, dentroDeKit: false, ...o,
  };
}

function pedido(o: Partial<Pedido> = {}): Pedido {
  return {
    chave: '1', isPack: false, orderIds: [1], vendaIds: ['v1'], data: null,
    comprador_id: null, comprador_nick: null, comprador_nome: null, status: 'paid', faturavel: true,
    statusDetail: null, shipping_status: null, shipping_substatus: null, shipping_logistic: null,
    uf: null, cidade: null, unidades: 1, unidadesFaturaveis: 1, bruto: 39.9, brutoFaturavel: 39.9,
    frete: 7.15, liquido: 21.78, money_release_date: null, temMembrosSemDataLiberacao: false,
    sacado_em: null, sacado_por: null, estorno: 0, custo: 11.55, imposto: 6.38, markup: 0.886,
    comissao: 4.59, rastreio: null, is_publiai: false, tem_devolucao: false, ehKit: false,
    itens: [item()], ...o,
  };
}

describe('cascataDoPedido', () => {
  it('fecha a conta do exemplo aprovado', () => {
    const c = cascataDoPedido(pedido());
    expect(c.venda).toBe(39.9);
    expect(c.recebido).toBe(28.16);
    expect(c.ajustes).toBe(0);
    expect(c.margem).toBe(10.23);
    expect(c.margemPct).toBeCloseTo(25.6, 1);
    expect(c.markup).toBeCloseTo(0.886, 3);
    expect(c.aliquotaPct).toBe(16);
    expect(c.custoCompleto).toBe(true);
  });

  it('ajustes != 0 vira resíduo com sinal real', () => {
    expect(cascataDoPedido(pedido({ brutoFaturavel: 41.9, bruto: 41.9 })).ajustes).toBe(2);
    expect(cascataDoPedido(pedido({ brutoFaturavel: 37.9, bruto: 37.9 })).ajustes).toBe(-2);
  });

  it('sem custo: margem e % nulas, custo incompleto', () => {
    const c = cascataDoPedido(pedido({ custo: null, markup: null, itens: [item({ custo: null, markup: null })] }));
    expect(c.custo).toBeNull();
    expect(c.margem).toBeNull();
    expect(c.margemPct).toBeNull();
    expect(c.custoCompleto).toBe(false);
  });

  it('pack com custo parcial: mantém custo, mas sem margem', () => {
    const c = cascataDoPedido(pedido({
      itens: [item({ id: 'a' }), item({ id: 'b', custo: null, markup: null })],
    }));
    expect(c.custo).toBe(11.55);
    expect(c.custoCompleto).toBe(false);
    expect(c.margem).toBeNull();
    expect(c.markup).toBeNull(); // custo incompleto infla o markup (revisão Grok)
  });

  it('item não faturável sem custo não impede custo completo', () => {
    const c = cascataDoPedido(pedido({
      itens: [item({ id: 'a' }), item({ id: 'b', custo: null, faturavel: false })],
    }));
    expect(c.custoCompleto).toBe(true);
  });

  it('pedido não faturável: zeros e frete 0', () => {
    const c = cascataDoPedido(pedido({
      faturavel: false, brutoFaturavel: 0, comissao: 0, liquido: 0, imposto: 0, custo: null, markup: null,
      itens: [item({ faturavel: false, custo: 11.55, imposto: 0, liquido: 0, markup: null })],
    }));
    expect(c.venda).toBe(0);
    expect(c.frete).toBe(0);
    expect(c.recebido).toBe(0);
    expect(c.ajustes).toBe(0);
    expect(c.custoCompleto).toBe(false);
    expect(c.margemPct).toBeNull();
  });

  it('alíquota ponderada em origens mistas', () => {
    const c = cascataDoPedido(pedido({
      imposto: 24,
      itens: [
        item({ id: 'a', unit_price: 50, quantity: 2, imposto: 8, aliquotaPct: 8 }),
        item({ id: 'b', unit_price: 25, quantity: 4, imposto: 16, aliquotaPct: 16 }),
      ],
    }));
    expect(c.aliquotaPct).toBe(12);
  });
});
