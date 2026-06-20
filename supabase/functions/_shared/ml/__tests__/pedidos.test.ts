import { describe, it, expect } from 'vitest';
import { mapearPagamentoParaItem, type PedidoComPagamentos } from '../pedidos';

describe('mapearPagamentoParaItem', () => {
  it('mapeia cada pagamento do pedido para o item, somando a quantidade', () => {
    const pedidos: PedidoComPagamentos[] = [
      {
        id: 1,
        order_items: [{ item: { id: 'MLB1' }, quantity: 2 }],
        payments: [{ id: 111 }],
      },
    ];
    expect(mapearPagamentoParaItem(pedidos)).toEqual({
      '111': { mlItemId: 'MLB1', mlVariationId: null, quantidade: 2 },
    });
  });

  it('captura a variação vendida (ml_variation_id) quando há uma única', () => {
    const r = mapearPagamentoParaItem([
      { id: 7, order_items: [{ item: { id: 'MLB7', variation_id: 9988 }, quantity: 1 }], payments: [{ id: 700 }] },
    ]);
    expect(r['700']).toEqual({ mlItemId: 'MLB7', mlVariationId: '9988', quantidade: 1 });
  });

  it('variação fica null quando o pedido tem duas variações distintas do mesmo item', () => {
    const r = mapearPagamentoParaItem([
      {
        id: 8,
        order_items: [
          { item: { id: 'MLB8', variation_id: 1 }, quantity: 1 },
          { item: { id: 'MLB8', variation_id: 2 }, quantity: 1 },
        ],
        payments: [{ id: 800 }],
      },
    ]);
    expect(r['800']).toEqual({ mlItemId: 'MLB8', mlVariationId: null, quantidade: 2 });
  });

  it('chaveia por string mesmo com id numérico e múltiplos pagamentos no pedido', () => {
    const r = mapearPagamentoParaItem([
      { id: 9, order_items: [{ item: { id: 'MLB9' }, quantity: 1 }], payments: [{ id: 500 }, { id: 501 }] },
    ]);
    expect(r['500']).toEqual({ mlItemId: 'MLB9', mlVariationId: null, quantidade: 1 });
    expect(r['501']).toEqual({ mlItemId: 'MLB9', mlVariationId: null, quantidade: 1 });
  });

  it('ignora pedidos com mais de um item distinto (custo ambíguo)', () => {
    const r = mapearPagamentoParaItem([
      {
        id: 2,
        order_items: [
          { item: { id: 'MLB1' }, quantity: 1 },
          { item: { id: 'MLB2' }, quantity: 1 },
        ],
        payments: [{ id: 222 }],
      },
    ]);
    expect(r).toEqual({});
  });

  it('soma a quantidade quando o mesmo item aparece em duas linhas do pedido', () => {
    const r = mapearPagamentoParaItem([
      {
        id: 3,
        order_items: [
          { item: { id: 'MLB1' }, quantity: 2 },
          { item: { id: 'MLB1' }, quantity: 3 },
        ],
        payments: [{ id: 333 }],
      },
    ]);
    expect(r['333']).toEqual({ mlItemId: 'MLB1', mlVariationId: null, quantidade: 5 });
  });

  it('ignora pedido sem item ou sem pagamento', () => {
    const r = mapearPagamentoParaItem([
      { id: 4, order_items: [], payments: [{ id: 444 }] },
      { id: 5, order_items: [{ item: { id: 'MLB5' }, quantity: 1 }], payments: [] },
    ]);
    expect(r).toEqual({});
  });
});
