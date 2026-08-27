import { describe, expect, it } from 'vitest';
import type { Pedido } from '../pedidos-faturamento';
import {
  selecionarPedidosFaturaveis,
  resumoSelecaoSaque,
} from '../saque-selecao';

function pedido(chave: string, faturavel = true): Pedido {
  return {
    chave,
    isPack: false,
    orderIds: [Number(chave)],
    vendaIds: [chave],
    data: null,
    comprador_id: null,
    comprador_nick: null,
    comprador_nome: `Comprador ${chave}`,
    status: faturavel ? 'paid' : 'cancelled',
    statusDetail: null,
    shipping_status: null,
    shipping_substatus: null,
    uf: null,
    cidade: null,
    unidades: 1,
    bruto: 10,
    brutoFaturavel: faturavel ? 10 : 0,
    frete: null,
    estorno: faturavel ? 0 : 10,
    liquido: faturavel ? 8 : 0,
    imposto: faturavel ? 1 : 0,
    markup: null,
    custo: null,
    comissao: 0,
    rastreio: null,
    temMembrosSemDataLiberacao: false,
    money_release_date: null,
    sacado_em: null,
    sacado_por: null,
    faturavel,
    tem_devolucao: !faturavel,
    itens: [],
    is_publiai: true,
  };
}

describe('seleção global do saque', () => {
  it('seleciona todos os faturáveis do filtro, inclusive além da primeira página, e desmarca o mesmo universo', () => {
    const pedidos = [
      ...Array.from({ length: 51 }, (_, i) => pedido(String(i + 1))),
      pedido('52', false),
    ];

    const selecionados = selecionarPedidosFaturaveis(new Set(), pedidos, true);
    expect(selecionados).toHaveLength(51);
    expect(selecionados.has('51')).toBe(true);
    expect(selecionados.has('52')).toBe(false);

    expect(selecionarPedidosFaturaveis(selecionados, pedidos, false)).toHaveLength(0);
  });

  it('mantém a confirmação para desfazer saque acima de 20 itens', () => {
    const sacados = Array.from({ length: 21 }, (_, i) => pedido(String(i + 1)));
    for (const p of sacados) p.sacado_em = '2026-08-27T12:00:00Z';

    expect(resumoSelecaoSaque(sacados).precisaConfirmar).toBe(true);
  });
});
