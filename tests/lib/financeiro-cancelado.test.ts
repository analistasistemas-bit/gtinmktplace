// Venda devolvida/cancelada no Detalhe Financeiro: não entra nos totais (ADR-0038) e não pode
// aparecer como se o ML tivesse retido o valor inteiro — o dinheiro voltou ao comprador.
import { describe, it, expect } from 'vitest';
import { agruparPorPedido, totaisFinanceiro, retidoDoPedido, rotuloNaoFaturavel } from '@/lib/pedidos-faturamento';
import { buildFinanceiroDetalheReport } from '@/lib/export/adapters';
import type { Venda, VendaItem } from '@/lib/faturamento';
import { calcularResumo, type CustoResolver } from '@/lib/resumo-vendas';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return {
    id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'FITA CETIM',
    codigo: '001', cor: null, ean: '789', quantity: 1, unit_price: 10,
    sale_fee: 0, is_publiai: true, ...over,
  };
}
function venda(over: Partial<Venda> = {}): Venda {
  return {
    id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-07-27T00:00:00Z', date_created: null, comprador_nick: 'cliente',
    comprador_id: 100, total_amount: 10, paid_amount: 10, sale_fee_total: 1,
    frete_vendedor: null, liquido: 9, estorno: null, money_release_date: null,
    currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
    shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, itens: [item()], ...over,
  };
}

const custo: CustoResolver = () => 4;

describe('totaisFinanceiro', () => {
  it('ignora pedido cancelado/devolvido no bruto, retido, líquido e markup', () => {
    const pedidos = agruparPorPedido([
      venda({ id: 'a', order_id: 1, total_amount: 100, liquido: 80 }),
      // Devolução: ML cancela a order e estorna 100% — o caso real de julho/2026.
      venda({
        id: 'b', order_id: 2, status: 'cancelled', total_amount: 384.8, liquido: 289.68,
        estorno: 384.8, tem_devolucao: true, itens: [item({ id: 'i2', unit_price: 384.8 })],
      }),
    ], custo);

    const t = totaisFinanceiro(pedidos);
    expect(t.bruto).toBe(100);      // sem os R$ 384,80 da devolução
    expect(t.retido).toBe(20);      // 100 − 80; a devolvida não soma retido nenhum
    expect(t.liquido).toBe(80);
    expect(t.markup).toBeCloseTo((80 - 4) / 4, 6); // só o custo do pedido faturável
  });

  it('sem pedido faturável devolve zeros e markup null', () => {
    const pedidos = agruparPorPedido([
      venda({ id: 'b', order_id: 2, status: 'cancelled', total_amount: 50, tem_devolucao: true }),
    ], custo);
    expect(totaisFinanceiro(pedidos)).toEqual({ bruto: 0, retido: 0, liquido: 0, markup: null });
  });

  it('pack misto (1 order cancelada + 1 paga) conta só a parte faturável, mesmo com o menor order_id cancelado', () => {
    // Caso real (pack 2000013737917865, jun/2026): o `status` representativo do pedido vem do menor
    // order_id, que está cancelled — descartar o pedido inteiro perderia a venda paga do mesmo pack.
    const pedidos = agruparPorPedido([
      venda({ id: 'a', order_id: 1, pack_id: 9, shipping_id: 9, status: 'cancelled', total_amount: 16, liquido: 14,
        itens: [item({ id: 'i1', unit_price: 16 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 9, shipping_id: 9, status: 'paid', total_amount: 40, liquido: 33,
        itens: [item({ id: 'i2', unit_price: 40 })] }),
    ]);
    expect(pedidos).toHaveLength(1);
    const [p] = pedidos;
    expect(rotuloNaoFaturavel(p)).toBeNull();   // tem parte faturável: não é uma linha devolvida
    expect(p.brutoFaturavel).toBe(40);          // os R$ 16 cancelados ficam fora
    expect(retidoDoPedido(p)).toBe(7);          // 40 − 33

    const t = totaisFinanceiro(pedidos);
    expect(t.bruto).toBe(40);
    expect(t.retido).toBe(7);
    expect(t.liquido).toBe(33);
  });

  it('retidoDoPedido de venda cancelada é 0, não o bruto inteiro', () => {
    const [p] = agruparPorPedido([
      venda({ id: 'b', order_id: 2, status: 'cancelled', total_amount: 384.8, tem_devolucao: true }),
    ]);
    expect(retidoDoPedido(p)).toBe(0);
  });
});

describe('rodapé do Detalhe Financeiro == banner de KPIs', () => {
  // O banner usa calcularResumo (por venda) e o rodapé usa totaisFinanceiro (por pack): os dois
  // caminhos precisam fechar no mesmo número para o mesmo conjunto, senão a tela se contradiz.
  it('bate em bruto, retido e líquido com pack, devolução e pack misto juntos', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, total_amount: 59.99, liquido: 43.84, sale_fee_total: 7.2,
        itens: [item({ id: 'i1', unit_price: 59.99 })] }),
      // pack de 2 orders com frete compartilhado (rateio entra nos dois caminhos)
      venda({ id: 'b', order_id: 2, pack_id: 70, shipping_id: 70, total_amount: 12.5, liquido: 11,
        sale_fee_total: 1, frete_vendedor: 40.4, itens: [item({ id: 'i2', unit_price: 12.5 })] }),
      venda({ id: 'c', order_id: 3, pack_id: 70, shipping_id: 70, total_amount: 37.9, liquido: 31.46,
        sale_fee_total: 1, frete_vendedor: 40.4, itens: [item({ id: 'i3', unit_price: 37.9 })] }),
      // devolvida: fora dos dois
      venda({ id: 'd', order_id: 4, status: 'cancelled', total_amount: 384.8, liquido: 289.68,
        estorno: 384.8, tem_devolucao: true, itens: [item({ id: 'i4', unit_price: 384.8 })] }),
      // pack misto: só a parte paga conta, nos dois
      venda({ id: 'e', order_id: 5, pack_id: 80, shipping_id: 80, status: 'cancelled', total_amount: 16,
        liquido: 14, itens: [item({ id: 'i5', unit_price: 16 })] }),
      venda({ id: 'f', order_id: 6, pack_id: 80, shipping_id: 80, total_amount: 40, liquido: 33,
        itens: [item({ id: 'i6', unit_price: 40 })] }),
    ];

    const banner = calcularResumo(vendas);
    const rodape = totaisFinanceiro(agruparPorPedido(vendas));

    expect(rodape.bruto).toBe(banner.bruto);
    expect(rodape.liquido).toBe(banner.liquido);
    expect(rodape.retido).toBe(banner.descontos);
  });
});

describe('buildFinanceiroDetalheReport', () => {
  it('marca a linha devolvida e não imprime retido/líquido como se fossem reais', () => {
    const pedidos = agruparPorPedido([
      venda({
        id: 'b', order_id: 2, status: 'cancelled', total_amount: 384.8, liquido: 289.68,
        estorno: 384.8, tem_devolucao: true, comprador_nick: 'stella',
        itens: [item({ id: 'i2', unit_price: 384.8 })],
      }),
    ]);
    const rel = buildFinanceiroDetalheReport({
      pedidos,
      totais: totaisFinanceiro(pedidos),
      filtroLib: 'todos',
      periodo: { tipo: 'range', desde: '2026-07-01', ate: '2026-07-31' },
      config: { formato: 'pdf', incluirKpis: true, expandido: false },
    });
    const linha = rel.linhas[0].celulas;
    expect(linha.comprador).toContain('devolvido');
    expect(linha.retido).toBe('—');
    expect(linha.liquido).toBe('—');
    expect(linha.markup).toBe('—');
  });
});
