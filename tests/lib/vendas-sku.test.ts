import { describe, it, expect } from 'vitest';
import { agruparPorPedido, calcularKpisPedidos } from '@/lib/pedidos-faturamento';
import { agregarPorSku, SEM_CODIGO } from '@/lib/vendas-sku';
import type { Venda, VendaItem } from '@/lib/faturamento';
import type { CustoResolver } from '@/lib/resumo-vendas';
import type { Janela } from '@/lib/metricas';

function item(over: Partial<VendaItem> = {}): VendaItem {
  return { id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'FITA', codigo: '001', cor: null,
    ean: '789', quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...over };
}
function venda(over: Partial<Venda> = {}): Venda {
  return { id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-09-10T12:00:00Z', date_created: null, comprador_nick: 'c', comprador_id: 100,
    total_amount: 10, paid_amount: 10, sale_fee_total: 1, frete_vendedor: null, liquido: 9, estorno: null,
    money_release_date: null, currency: 'BRL', shipping_id: null, shipping_status: null,
    shipping_substatus: null, shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, itens: [item()], ...over };
}
const SET: Janela = { desde: '2026-09-01T00:00:00.000Z', ate: '2026-09-30T23:59:59.999Z' };
const r2 = (n: number) => Math.round(n * 100) / 100;

describe('agregarPorSku', () => {
  it('soma dos SKUs bate com os KPIs da aba Vendas (bruto, líquido, unidades)', () => {
    const custo: CustoResolver = () => 4;
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 9, total_amount: 30, sale_fee_total: 3,
        itens: [item({ id: 'i1', codigo: 'A', unit_price: 10 }), item({ id: 'i2', codigo: 'B', unit_price: 20 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 9, status: 'cancelled', total_amount: 10,
        itens: [item({ id: 'i3', codigo: 'A', unit_price: 10 })] }),
      venda({ id: 'c', order_id: 3, total_amount: 10, itens: [item({ id: 'i4', codigo: 'A' })] }),
    ];
    const pedidos = agruparPorPedido(vendas, custo);
    const linhas = agregarPorSku(pedidos, SET, new Map());
    const k = calcularKpisPedidos(pedidos);
    expect(r2(linhas.reduce((s, l) => s + l.acc.bruto, 0))).toBe(k.bruto);
    expect(r2(linhas.reduce((s, l) => s + l.acc.liquido, 0))).toBe(k.liquido);
    expect(linhas.reduce((s, l) => s + l.acc.unidades, 0)).toBe(k.unidades);
    expect(linhas.find((l) => l.codigo === 'A')!.acc.canceladas).toBe(1);
  });

  it('lucro só dos itens com custo; fonte parcial; margem sobre o bruto desses itens', () => {
    const custo: CustoResolver = (it) => (it.id === 'i1' ? 4 : null);
    const vendas = [
      // Pedido avulso sem frete usa v.liquido direto (sales-summary.ts:336): liquido 10 explícito.
      venda({ id: 'a', order_id: 1, total_amount: 10, sale_fee_total: 0, liquido: 10, itens: [item({ id: 'i1', codigo: 'A', custo_congelado: 4 })] }),
      venda({ id: 'b', order_id: 2, total_amount: 10, sale_fee_total: 0, liquido: 10, itens: [item({ id: 'i2', codigo: 'A' })] }),
    ];
    const [l] = agregarPorSku(agruparPorPedido(vendas, custo), SET, new Map());
    expect(l.m.fonteCusto).toBe('parcial');
    expect(l.m.lucro).toBe(6);                 // 10 − 4, o item sem custo fica fora
    expect(l.m.markup).toBeCloseTo(1.5, 5);    // 6 ÷ 4
    expect(l.m.margemSVenda).toBeCloseTo(0.6, 5); // 6 ÷ 10 (bruto do item com custo)
    expect(l.m.lucroPorUnidade).toBe(6);
  });

  it('sem custo nenhum → lucro null e fonte sem_custo (nunca lucro = líquido)', () => {
    const [l] = agregarPorSku(agruparPorPedido([venda()]), SET, new Map());
    expect(l.m.lucro).toBeNull();
    expect(l.m.fonteCusto).toBe('sem_custo');
  });

  it('custo atual (não congelado) → fonte estimado', () => {
    const [l] = agregarPorSku(agruparPorPedido([venda()], () => 3), SET, new Map());
    expect(l.m.fonteCusto).toBe('estimado');
  });

  it('taxa de devolução conta pedidos: 1 devolvido em 2', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, tem_devolucao: true, status: 'cancelled', itens: [item({ id: 'i1', codigo: 'A' })] }),
      venda({ id: 'b', order_id: 2, itens: [item({ id: 'i2', codigo: 'A', quantity: 3 })] }),
    ];
    const [l] = agregarPorSku(agruparPorPedido(vendas), SET, new Map());
    expect(l.m.taxaDevolucao).toBe(0.5);
    expect(l.acc.canceladas).toBe(0);  // devolvida não é "cancelada"
  });

  it('item sem código vira a linha SEM_CODIGO e não some do total', () => {
    const linhas = agregarPorSku(agruparPorPedido([venda({ itens: [item({ codigo: null })] })]), SET, new Map());
    expect(linhas.map((l) => l.codigo)).toEqual([SEM_CODIGO]);
    expect(linhas[0].acc.bruto).toBe(10);
  });

  it('pedido fora da janela não entra', () => {
    const linhas = agregarPorSku(agruparPorPedido([venda({ date_closed: '2026-08-31T23:59:59.000Z' })]), SET, new Map());
    expect(linhas).toHaveLength(0);
  });

  it('usa o catálogo para título, família, fornecedor, estoque', () => {
    const cat = new Map([['001', { codigo: '001', codigoPai: '000', nomeFamilia: 'Fitas', nome: 'Fita azul', cor: null,
      tamanho: null, estoque: 7, fornecedor: 'F', origem: 'nacional' as const, ehKit: false, primeiraVenda: null, ultimaVenda: null }]]);
    const [l] = agregarPorSku(agruparPorPedido([venda()]), SET, cat);
    expect([l.titulo, l.nomeFamilia, l.fornecedor, l.estoque, l.origem]).toEqual(['Fita azul', 'Fitas', 'F', 7, 'nacional']);
  });
});
