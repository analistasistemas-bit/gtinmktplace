import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetalheMLPedido } from '@/lib/detalhe-ml-pedido';
import type { Pedido, ItemPedido } from '@/lib/pedidos-faturamento';

// Dados lazy do pagamento (payload cru do ML): controlados por teste.
const lazy = vi.hoisted(() => ({
  estado: { data: undefined, isPending: false, isError: false } as {
    data: DetalheMLPedido | undefined; isPending: boolean; isError: boolean;
  },
}));
vi.mock('@/hooks/useDetalheMLPedido', () => ({ useDetalheMLPedido: () => lazy.estado }));

import { DetalhePedidoItens } from '../detalhe-pedido-itens';

const detalheML = (o: Partial<DetalheMLPedido> = {}): DetalheMLPedido => ({
  pagamentos: ['Crédito Visa 3x'], aprovadoEm: '2026-10-02T11:00:00Z', freteComprador: 0, cupom: 0,
  tiposAnuncio: ['Clássico'], ...o,
});

beforeEach(() => {
  lazy.estado = { data: undefined, isPending: false, isError: false };
});

function item(overrides: Partial<ItemPedido>): ItemPedido {
  return {
    id: 'i1', ml_item_id: null, titulo: 'Produto', codigo: null, cor: null, ean: null,
    quantity: 1, unit_price: 50, imagem_path: null, custo: null, liquido: 40,
    imposto: 0, aliquotaPct: null, markup: null, faturavel: true, estorno: 0,
    custoEstimado: false, temDevolucao: false, orderId: 1, uf: null, dentroDeKit: false,
    ...overrides,
  };
}

function pedido(overrides: Partial<Pedido>): Pedido {
  return {
    chave: '1', isPack: false, orderIds: [1], vendaIds: ['v1'], data: null,
    comprador_id: null, comprador_nick: null, comprador_nome: null, status: 'paid',
    faturavel: true,
    statusDetail: null, shipping_status: null, shipping_substatus: null, shipping_logistic: null,
    uf: null, cidade: null,
    unidades: 1, unidadesFaturaveis: 1, bruto: 50, brutoFaturavel: 50, frete: null, liquido: 40, money_release_date: null,
    temMembrosSemDataLiberacao: false, sacado_em: null, sacado_por: null, estorno: 0,
    custo: null, imposto: 0, markup: null, comissao: 5, rastreio: null, is_publiai: false,
    tem_devolucao: false, ehKit: false, itens: [],
    ...overrides,
  };
}

function renderDetalhe(p: Pedido, props: Partial<React.ComponentProps<typeof DetalhePedidoItens>> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter><DetalhePedidoItens pedido={p} {...props} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Pedido do exemplo aprovado: venda 39,90, comissão 4,59, frete 7,15, imposto 6,38, custo 11,55. */
const pedidoCompleto = (o: Partial<Pedido> = {}) => pedido({
  bruto: 39.9, brutoFaturavel: 39.9, frete: 7.15, comissao: 4.59, liquido: 21.78, imposto: 6.38,
  custo: 11.55, markup: 0.886,
  itens: [item({ unit_price: 39.9, custo: 11.55, liquido: 21.78, imposto: 6.38, aliquotaPct: 16, markup: 0.886 })],
  ...o,
});

describe('DetalhePedidoItens', () => {
  // Regressão: o pack linkava para `/vendas/pacote/{chave}/detalhe`, rota que o ML descontinuou —
  // devolve 301 para `/vendas/lista` (medido em 15/09/2026). A rota viva aceita pack e order.
  it('linka o pack pela rota de venda, não pela rota de pacote', () => {
    renderDetalhe(pedido({ chave: '900099', isPack: true, orderIds: [123, 124] }));
    const link = screen.getByRole('link', { name: /mercado livre/i });
    expect(link).toHaveAttribute('href', 'https://www.mercadolivre.com.br/vendas/900099/detalhe');
    expect(screen.getByText('2 pedidos')).toBeInTheDocument();
  });

  it('rastreio não aparece mais', () => {
    renderDetalhe(pedido({ rastreio: 'BR123456789' }));
    expect(screen.queryByText(/rastreio/i)).not.toBeInTheDocument();
    expect(screen.queryByText('BR123456789')).not.toBeInTheDocument();
  });

  it('mostra a alíquota no rótulo do imposto', () => {
    renderDetalhe(pedido({
      imposto: 6.78,
      itens: [item({ unit_price: 84.75, quantity: 1, imposto: 6.78, aliquotaPct: 8 })],
    }));
    expect(screen.getByText('Imposto 8%')).toBeInTheDocument();
  });

  // Regressão: derivar o % de `imposto ÷ valor` dava 7,99% aqui (44,55 × 8% = 3,564, gravado 3,56).
  it('mostra a alíquota crua, sem o erro do imposto arredondado a centavos', () => {
    renderDetalhe(pedido({
      imposto: 3.56,
      itens: [item({ unit_price: 44.55, quantity: 1, imposto: 3.56, aliquotaPct: 8 })],
    }));
    expect(screen.getByText('Imposto 8%')).toBeInTheDocument();
  });

  it('mostra a média ponderada quando os itens têm origens/alíquotas diferentes', () => {
    renderDetalhe(pedido({
      imposto: 24,
      itens: [
        item({ id: 'i1', unit_price: 50, quantity: 2, imposto: 8, aliquotaPct: 8 }), // base 100
        item({ id: 'i2', unit_price: 25, quantity: 4, imposto: 16, aliquotaPct: 16 }), // base 100
      ],
    }));
    expect(screen.getByText('Imposto 12%')).toBeInTheDocument();
  });

  it('usa vírgula decimal quando a média ponderada não é inteira', () => {
    renderDetalhe(pedido({
      imposto: 12.8,
      itens: [
        item({ id: 'i1', unit_price: 100, quantity: 1, imposto: 8, aliquotaPct: 8 }), // base 100
        item({ id: 'i2', unit_price: 30, quantity: 1, imposto: 4.8, aliquotaPct: 16 }), // base 30
      ],
    })); // (8×100 + 16×30) ÷ 130 = 9,846…
    expect(screen.getByText('Imposto 9,8%')).toBeInTheDocument();
  });

  it('não mostra o percentual quando não há imposto ou a alíquota é desconhecida', () => {
    renderDetalhe(pedido({ imposto: 0, itens: [item({ imposto: 0, aliquotaPct: null })] }));
    expect(screen.getByText('Imposto')).toBeInTheDocument();
    expect(screen.queryByText(/Imposto \d/)).not.toBeInTheDocument();
  });

  it('alíquota desconhecida com imposto > 0 também fica sem percentual', () => {
    renderDetalhe(pedido({ imposto: 4, itens: [item({ imposto: 4, aliquotaPct: null })] }));
    expect(screen.queryByText(/Imposto \d/)).not.toBeInTheDocument();
  });
});

describe('DetalhePedidoItens — cascata de dinheiro', () => {
  it('mostra venda, líquido após ML, lucro, margem s/ venda e markup', () => {
    renderDetalhe(pedidoCompleto());
    const dinheiro = screen.getByRole('region', { name: 'Dinheiro' });
    expect(within(dinheiro).getByText('Venda')).toBeInTheDocument();
    expect(within(dinheiro).getByText('Líquido após ML')).toBeInTheDocument();
    expect(within(dinheiro).getByText('R$ 28,16')).toBeInTheDocument();
    expect(within(dinheiro).getByText('Lucro')).toBeInTheDocument();
    expect(within(dinheiro).getByText('R$ 10,23')).toBeInTheDocument();
    expect(within(dinheiro).getByText('Margem s/ venda 25,6%')).toBeInTheDocument();
    expect(within(dinheiro).getByText('Markup +89%')).toBeInTheDocument();
    expect(within(dinheiro).queryByText(/Recebido no MP/)).not.toBeInTheDocument();
    expect(within(dinheiro).queryByText('Outros ajustes')).not.toBeInTheDocument();
  });

  it('margem negativa fica vermelha', () => {
    renderDetalhe(pedidoCompleto({ liquido: 5, custo: 11.55, markup: -0.5 }));
    expect(screen.getByText('−R$ 6,55')).toHaveClass('text-destructive');
  });

  it('mostra "Outros ajustes" com o sinal real quando a conta não fecha sozinha', () => {
    // Venda 41,90 − comissão − frete = 30,16, mas o líquido é 28,16: saíram mais R$ 2,00.
    renderDetalhe(pedidoCompleto({ bruto: 41.9, brutoFaturavel: 41.9 }));
    expect(screen.getByText('Outros ajustes')).toBeInTheDocument();
    expect(screen.getByText('−R$ 2,00')).toBeInTheDocument();
  });

  it('"Outros ajustes" positivo quando o líquido supera a conta', () => {
    renderDetalhe(pedidoCompleto({ bruto: 37.9, brutoFaturavel: 37.9 }));
    expect(screen.getByText('+R$ 2,00')).toBeInTheDocument();
  });

  it('sem custo: custo e margem em "—" com aviso para cadastrar', () => {
    renderDetalhe(pedidoCompleto({ custo: null, markup: null, itens: [item({ unit_price: 39.9, custo: null })] }));
    expect(screen.getByText('Cadastre o custo para ver a margem')).toBeInTheDocument();
    expect(screen.queryByText(/da venda/)).not.toBeInTheDocument();
  });

  it('pack com custo parcial: custo "(parcial)", margem "—" e aviso', () => {
    renderDetalhe(pedidoCompleto({
      itens: [item({ id: 'a', custo: 11.55 }), item({ id: 'b', custo: null })],
    }));
    expect(screen.getByText('R$ 11,55 (parcial)')).toBeInTheDocument();
    expect(screen.getByText('Custo incompleto')).toBeInTheDocument();
    // O líquido do item sem custo inflaria o markup: sem custo completo, nada de markup.
    expect(screen.queryByText(/^Markup .*\(parcial\)/)).not.toBeInTheDocument();
  });

  it('pack misto: nota com o valor dos itens cancelados fora da conta', () => {
    renderDetalhe(pedidoCompleto({ bruto: 79.8 }));
    expect(screen.getByText('R$ 39,90 fora do faturamento (cancelado/devolvido)')).toBeInTheDocument();
  });

  it('pedido cancelado com custo no item não pede para cadastrar custo', () => {
    renderDetalhe(pedido({
      faturavel: false, bruto: 50, brutoFaturavel: 0, frete: 7.15, comissao: 0, liquido: 0, custo: null,
      itens: [item({ faturavel: false, liquido: 0, custo: 11.55 })],
    }));
    expect(screen.queryByText('Cadastre o custo para ver a margem')).not.toBeInTheDocument();
  });

  it('estorno aparece no Dinheiro, fora da conta', () => {
    renderDetalhe(pedidoCompleto({ estorno: 12.3 }));
    const dinheiro = screen.getByRole('region', { name: 'Dinheiro' });
    expect(within(dinheiro).getByText('Estornado ao comprador R$ 12,30 (fora da conta)')).toBeInTheDocument();
  });

  it('sinais da cascata são lidos pelo leitor de tela', () => {
    renderDetalhe(pedidoCompleto());
    const dinheiro = screen.getByRole('region', { name: 'Dinheiro' });
    expect(within(dinheiro).getAllByText('menos', { exact: false }).length).toBeGreaterThan(0);
    expect(dinheiro.querySelector('dl > p')).toBeNull();
  });

  it('pedido cancelado: frete zerado na cascata', () => {
    renderDetalhe(pedido({
      faturavel: false, bruto: 50, brutoFaturavel: 0, frete: 7.15, comissao: 0, liquido: 0,
      itens: [item({ faturavel: false, liquido: 0 })],
    }));
    const dinheiro = screen.getByRole('region', { name: 'Dinheiro' });
    expect(within(dinheiro).queryByText('R$ 7,15')).not.toBeInTheDocument();
    expect(within(dinheiro).queryByText('−R$ 7,15')).not.toBeInTheDocument();
  });

  it('liberação: a liberar, liberado e sacado', () => {
    const futuro = new Date(Date.now() + 5 * 864e5).toISOString();
    const passado = new Date(Date.now() - 5 * 864e5).toISOString();
    const { unmount } = renderDetalhe(pedidoCompleto({ money_release_date: futuro }));
    expect(screen.getByText(/^Libera em \d{2}\/\d{2}$/)).toBeInTheDocument();
    unmount();
    const r2 = renderDetalhe(pedidoCompleto({ money_release_date: passado }));
    expect(screen.getByText(/^Liberado em \d{2}\/\d{2}$/)).toBeInTheDocument();
    r2.unmount();
    renderDetalhe(pedidoCompleto({ money_release_date: passado, sacado_em: passado }));
    expect(screen.getByText(/^Sacado em \d{2}\/\d{2}$/)).toBeInTheDocument();
  });

  it('liberação parcial (membro sem data) não anuncia liberado', () => {
    const passado = new Date(Date.now() - 5 * 864e5).toISOString();
    renderDetalhe(pedidoCompleto({ money_release_date: passado, temMembrosSemDataLiberacao: true }));
    expect(screen.queryByText(/Liberado em/)).not.toBeInTheDocument();
  });

  it('liquidoBruto: o líquido do item soma o imposto de volta; a cascata não muda', () => {
    renderDetalhe(pedidoCompleto(), { liquidoBruto: true });
    const itens = screen.getByRole('region', { name: 'Itens' });
    expect(within(itens).getByText(/Líq R\$ 28,16/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Dinheiro' })).getByText('R$ 10,23')).toBeInTheDocument();
  });

  it('sem liquidoBruto o líquido do item já vem sem imposto', () => {
    renderDetalhe(pedidoCompleto());
    expect(within(screen.getByRole('region', { name: 'Itens' })).getByText(/Líq R\$ 21,78/)).toBeInTheDocument();
  });
});

describe('DetalhePedidoItens — itens', () => {
  it('cor e EAN vazios não aparecem como "—"', () => {
    renderDetalhe(pedido({ itens: [item({ codigo: '02844290', cor: null, ean: null })] }));
    const itens = screen.getByRole('region', { name: 'Itens' });
    expect(within(itens).queryByText(/Cor/)).not.toBeInTheDocument();
    expect(within(itens).queryByText(/EAN/)).not.toBeInTheDocument();
    expect(within(itens).getByText(/02844290/)).toBeInTheDocument();
  });

  it('cor e EAN presentes aparecem', () => {
    renderDetalhe(pedido({ itens: [item({ cor: 'Azul', ean: '7890000000001' })] }));
    expect(screen.getByText(/EAN 7890000000001/)).toBeInTheDocument();
    expect(screen.getByText(/Azul/)).toBeInTheDocument();
  });

  it('com mais de um item mostra o cabeçalho "N itens"', () => {
    renderDetalhe(pedido({ itens: [item({ id: 'a' }), item({ id: 'b' })] }));
    expect(screen.getByText('2 itens')).toBeInTheDocument();
  });

  it('com um item não mostra o cabeçalho de contagem', () => {
    renderDetalhe(pedido({ itens: [item({})] }));
    expect(screen.queryByText(/\d+ itens/)).not.toBeInTheDocument();
  });

  it('destaque marca só os itens dos códigos pedidos', () => {
    renderDetalhe(
      pedido({ itens: [item({ id: 'a', codigo: '111', titulo: 'Alvo' }), item({ id: 'b', codigo: '222', titulo: 'Outro' })] }),
      { destaque: { codigos: new Set(['111']), rotulo: 'Este SKU' } },
    );
    expect(screen.getAllByText('Este SKU')).toHaveLength(1);
  });
});

describe('DetalhePedidoItens — item cancelado/estornado', () => {
  it('marca o item cancelado com o valor estornado', () => {
    renderDetalhe(pedido({ itens: [
      item({ id: 'a', faturavel: false, estorno: 124.38 }),
      item({ id: 'b' }),
    ] }));
    expect(screen.getByText('cancelado · estornado R$ 124,38')).toBeInTheDocument();
    expect(screen.getAllByText(/cancelado|estornado/)).toHaveLength(1);
  });

  it('estorno parcial em item faturável mostra só o estorno', () => {
    renderDetalhe(pedido({ itens: [item({ estorno: 10 })] }));
    expect(screen.getByText('estornado R$ 10,00')).toBeInTheDocument();
  });
});

describe('DetalhePedidoItens — link do SKU (Faturamento › Vendas)', () => {
  it('item com código leva ao dossiê; item sem código fica sem link', () => {
    renderDetalhe(
      pedido({ itens: [item({ id: 'a', codigo: '02989271' }), item({ id: 'b', codigo: null, titulo: 'Sem código' })] }),
      { linkSku: true },
    );
    expect(screen.getByRole('link', { name: '02989271' })).toHaveAttribute('href', '/faturamento/sku/02989271');
    expect(screen.getAllByRole('link').filter((l) => l.getAttribute('href')?.startsWith('/faturamento/sku/'))).toHaveLength(1);
  });
});

describe('DetalhePedidoItens — zona Pedido', () => {
  it('comprador, nick, cidade/UF, logística e status de envio', () => {
    renderDetalhe(pedido({
      comprador_nome: 'Maria Souza Lima', comprador_nick: 'MARIA123', cidade: 'Campinas', uf: 'SP',
      shipping_logistic: 'xd_drop_off', shipping_status: 'pending', data: '2026-10-02T11:08:00Z',
    }));
    expect(screen.getByText('Maria Souza Lima')).toBeInTheDocument();
    expect(screen.getByText('@MARIA123')).toBeInTheDocument();
    expect(screen.getByText('Campinas/SP')).toBeInTheDocument();
    expect(screen.getByText('Places · Preparando')).toBeInTheDocument();
    expect(screen.getByText(/02\/10\/2026/)).toBeInTheDocument();
  });

  it('copia o número do pedido e confirma com "Copiado"', async () => {
    const user = userEvent.setup();
    renderDetalhe(pedido({ orderIds: [2000012345678], chave: '2000012345678' }));
    await user.click(screen.getByRole('button', { name: /copiar/i }));
    expect(await navigator.clipboard.readText()).toBe('2000012345678');
    expect(screen.getByRole('button', { name: 'Copiado' })).toBeInTheDocument();
  });
});

describe('DetalhePedidoItens — dados lazy do pagamento', () => {
  it('carregando: skeleton e nenhuma linha de pagamento', () => {
    lazy.estado = { data: undefined, isPending: true, isError: false };
    renderDetalhe(pedidoCompleto());
    expect(screen.getByTestId('pagamento-carregando')).toBeInTheDocument();
    expect(screen.queryByText(/Pagamento/)).not.toBeInTheDocument();
  });

  it('erro: avisa "Pagamento indisponível" e o resto do detalhe segue', () => {
    lazy.estado = { data: undefined, isPending: false, isError: true };
    renderDetalhe(pedidoCompleto());
    expect(screen.queryByTestId('pagamento-carregando')).not.toBeInTheDocument();
    expect(screen.getByText('Pagamento indisponível')).toBeInTheDocument();
    expect(screen.getByText('Lucro')).toBeInTheDocument();
    expect(screen.getByText('Comissão ML')).toBeInTheDocument();
  });

  it('dados: pagamento, frete do comprador, cupom e tipo de anúncio na comissão', () => {
    lazy.estado = { data: detalheML({ freteComprador: 12.5, cupom: 3 }), isPending: false, isError: false };
    renderDetalhe(pedidoCompleto());
    expect(screen.getByText('Crédito Visa 3x')).toBeInTheDocument();
    expect(screen.getByText('R$ 12,50')).toBeInTheDocument();
    expect(screen.getByText('R$ 3,00')).toBeInTheDocument();
    expect(screen.getByText('Comissão Clássico')).toBeInTheDocument();
  });

  it('frete do comprador e cupom zerados não aparecem; vários tipos de anúncio caem em "Comissão ML"', () => {
    lazy.estado = { data: detalheML({ tiposAnuncio: ['Clássico', 'Premium'] }), isPending: false, isError: false };
    renderDetalhe(pedidoCompleto());
    expect(screen.queryByText(/Frete pago pelo comprador/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cupom/)).not.toBeInTheDocument();
    expect(screen.getByText('Comissão ML')).toBeInTheDocument();
  });
});
