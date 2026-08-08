import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DetalhePedidoItens } from '../detalhe-pedido-itens';
import type { Pedido, ItemPedido } from '@/lib/pedidos-faturamento';

function renderComProvider(p: Pedido) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DetalhePedidoItens pedido={p} />
    </QueryClientProvider>,
  );
}

function item(overrides: Partial<ItemPedido>): ItemPedido {
  return {
    id: 'i1', ml_item_id: null, titulo: 'Produto', codigo: null, cor: null, ean: null,
    quantity: 1, unit_price: 50, imagem_path: null, custo: null, liquido: 40, imposto: 0, markup: null,
    ...overrides,
  };
}

function pedido(overrides: Partial<Pedido>): Pedido {
  return {
    chave: '1', isPack: false, orderIds: [1], vendaIds: ['v1'], data: null,
    comprador_id: null, comprador_nick: null, comprador_nome: null, status: 'paid',
    statusDetail: null, shipping_status: null, shipping_substatus: null, uf: null, cidade: null,
    unidades: 1, bruto: 50, frete: null, liquido: 40, money_release_date: null,
    temMembrosSemDataLiberacao: false, sacado_em: null, sacado_por: null, estorno: 0,
    custo: null, imposto: 0, markup: null, comissao: 5, rastreio: null, is_publiai: false,
    tem_devolucao: false, itens: [],
    ...overrides,
  };
}

describe('DetalhePedidoItens', () => {
  it('mostra a alíquota entre parênteses ao lado do imposto', () => {
    const p = pedido({
      imposto: 4,
      itens: [item({ id: 'i1', unit_price: 50, quantity: 1, imposto: 4 })], // 50 × 8% = 4
    });
    renderComProvider(p);
    expect(screen.getByText('(8%)')).toBeInTheDocument();
  });

  it('mostra a média ponderada quando os itens têm origens/alíquotas diferentes', () => {
    const p = pedido({
      imposto: 24,
      itens: [
        item({ id: 'i1', unit_price: 50, quantity: 2, imposto: 8 }), // base 100 × 8%
        item({ id: 'i2', unit_price: 25, quantity: 4, imposto: 16 }), // base 100 × 16%
      ],
    });
    renderComProvider(p);
    expect(screen.getByText('(12%)')).toBeInTheDocument();
  });

  it('não mostra o percentual quando não há imposto', () => {
    const p = pedido({ imposto: 0, itens: [item({ imposto: 0 })] });
    renderComProvider(p);
    expect(screen.queryByText(/%\)/)).not.toBeInTheDocument();
  });
});
