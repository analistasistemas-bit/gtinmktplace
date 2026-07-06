import { describe, it, expect } from 'vitest';
import { agruparPorPedido, nomeCurtoComprador, nomeExibicaoComprador, pedidoCasaBusca } from '@/lib/pedidos-faturamento';
import type { Venda, VendaItem } from '@/lib/faturamento';
import type { CustoResolver, AliquotaResolver } from '@/lib/resumo-vendas';

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
    date_closed: '2026-06-15T00:00:00Z', date_created: null, comprador_nick: 'cliente',
    comprador_id: 100, total_amount: 10, paid_amount: 10, sale_fee_total: 1,
    frete_vendedor: null, liquido: 9, estorno: null, money_release_date: null,
    currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
    shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, itens: [item()], ...over,
  };
}

describe('agruparPorPedido', () => {
  it('agrupa orders do mesmo pack numa linha (frete uma vez, valores somados)', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 50, shipping_id: 99, total_amount: 12.5, liquido: 11, frete_vendedor: 40.4,
        itens: [item({ id: 'i1', titulo: 'A', unit_price: 12.5, quantity: 1 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 50, shipping_id: 99, total_amount: 37.9, liquido: 31.46, frete_vendedor: 40.4,
        itens: [item({ id: 'i2', titulo: 'B', unit_price: 37.9, quantity: 1 })] }),
    ];
    const pedidos = agruparPorPedido(vendas);
    expect(pedidos).toHaveLength(1);
    const p = pedidos[0];
    expect(p.isPack).toBe(true);
    expect(p.orderIds).toEqual([1, 2]);
    expect(p.bruto).toBe(50.4);          // 12.5 + 37.9
    expect(p.frete).toBe(40.4);          // uma vez, não 80.8
    expect(p.liquido).toBe(8);           // bruto 50.4 − comissão 2 − frete 40.4 (ADR-0042)
    expect(p.unidades).toBe(2);
    expect(p.itens).toHaveLength(2);
  });

  it('pedido sem pack vira 1 linha (chave = order_id)', () => {
    const pedidos = agruparPorPedido([venda({ id: 'a', order_id: 7, pack_id: null })]);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].isPack).toBe(false);
    expect(pedidos[0].chave).toBe('7');
  });

  it('markup do pedido e por produto usando custo (rateio do líquido por valor)', () => {
    const custo: CustoResolver = (it) => (it.id === 'i1' ? 5 : 10); // custo unitário
    const vendas = [venda({
      id: 'a', order_id: 1, pack_id: null, total_amount: 30, liquido: 24,
      itens: [
        item({ id: 'i1', titulo: 'A', unit_price: 10, quantity: 1 }),   // valor 10
        item({ id: 'i2', titulo: 'B', unit_price: 20, quantity: 1 }),   // valor 20
      ],
    })];
    const p = agruparPorPedido(vendas, custo)[0];
    expect(p.custo).toBe(15);                 // 5 + 10
    // markup do pedido = (24 - 15)/15 = 0.6
    expect(p.markup).toBeCloseTo(0.6, 5);
    // líquido rateado por valor: i1 = 24*10/30 = 8 ; i2 = 24*20/30 = 16
    const i1 = p.itens.find((x) => x.id === 'i1')!;
    const i2 = p.itens.find((x) => x.id === 'i2')!;
    expect(i1.liquido).toBe(8);
    expect(i2.liquido).toBe(16);
    expect(i1.markup).toBeCloseTo((8 - 5) / 5, 5);   // 0.6
    expect(i2.markup).toBeCloseTo((16 - 10) / 10, 5); // 0.6
  });

  it('imposto por origem reduz o markup do item e do pedido (ADR-0055)', () => {
    const custo: CustoResolver = () => 40;      // custo unitário 40
    const aliquota: AliquotaResolver = () => 10; // 10%
    const vendas = [venda({
      id: 'a', order_id: 1, pack_id: null, total_amount: 100, liquido: 80,
      itens: [item({ id: 'i1', unit_price: 100, quantity: 1 })],
    })];

    const semImposto = agruparPorPedido(vendas, custo)[0];
    const comImposto = agruparPorPedido(vendas, custo, undefined, undefined, aliquota)[0];

    expect(semImposto.imposto).toBe(0);
    expect(semImposto.markup).toBeCloseTo(1.0, 5);   // (80 − 40) / 40
    expect(comImposto.imposto).toBe(10);             // 100 × 10%
    expect(comImposto.itens[0].imposto).toBe(10);
    expect(comImposto.markup).toBeCloseTo(0.75, 5);  // (80 − 10 − 40) / 40
    expect(comImposto.markup!).toBeLessThan(semImposto.markup!);
    // KPI agregado desconta o imposto do líquido com custo.
    expect(calcularKpisPedidos([comImposto]).markup).toBeCloseTo(0.75, 5);
  });

  it('sem custo cadastrado → markup null', () => {
    const p = agruparPorPedido([venda({ id: 'a' })])[0];
    expect(p.custo).toBeNull();
    expect(p.markup).toBeNull();
    expect(p.itens[0].markup).toBeNull();
  });

  it('pack cancelado zera líquido/imposto e nula custo/markup, mesmo com custo e frete duplicado por pedido', () => {
    // Reproduz o bug relatado: pack de 2 pedidos cancelado. Antes do fix, o líquido cru (não
    // rateado, pois ratearLiquidoPorFrete pula não-faturáveis) somado ao imposto ainda calculado
    // dava markup ~-200% em vez de "—".
    const custo: CustoResolver = (it) => (it.id === 'i1' ? 1.53 : 1.91);
    const aliquota: AliquotaResolver = () => 8; // nunca deve aparecer num pedido cancelado
    const vendas = [
      venda({
        id: 'a', order_id: 1, pack_id: 99, status: 'cancelled', total_amount: 12.80,
        sale_fee_total: 1.42, frete_vendedor: 11.30, liquido: 0.08,
        itens: [item({ id: 'i1', unit_price: 12.80 })],
      }),
      venda({
        id: 'b', order_id: 2, pack_id: 99, status: 'cancelled', total_amount: 13.68,
        sale_fee_total: 1.62, frete_vendedor: 11.30, liquido: 0.76,
        itens: [item({ id: 'i2', unit_price: 13.68 })],
      }),
    ];
    const p = agruparPorPedido(vendas, custo, undefined, undefined, aliquota)[0];
    expect(p.liquido).toBe(0);
    expect(p.imposto).toBe(0);
    expect(p.custo).toBeNull();
    expect(p.markup).toBeNull();
    for (const it of p.itens) {
      expect(it.liquido).toBe(0);
      expect(it.imposto).toBe(0);
      expect(it.markup).toBeNull();
    }
    // Custo do produto continua visível (é atributo do item, não da venda cancelada).
    expect(p.itens.find((x) => x.id === 'i1')?.custo).toBe(1.53);
    expect(calcularKpisPedidos([p]).pedidos).toBe(0);
  });
});

import { calcularKpisPedidos } from '@/lib/pedidos-faturamento';

describe('calcularKpisPedidos', () => {
  it('conta pedidos reais (packs), ticket e itens por pedido sobre faturáveis', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 50, total_amount: 12.5, shipping_status: 'ready_to_ship',
        itens: [item({ id: 'i1', quantity: 1 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 50, total_amount: 37.5, shipping_status: 'ready_to_ship',
        itens: [item({ id: 'i2', quantity: 1 })] }),
      venda({ id: 'c', order_id: 3, pack_id: null, total_amount: 50, shipping_status: 'shipped',
        comprador_id: 200, itens: [item({ id: 'i3', quantity: 2 })] }),
    ];
    const k = calcularKpisPedidos(agruparPorPedido(vendas));
    expect(k.pedidos).toBe(2);             // 1 pack + 1 solo
    expect(k.unidades).toBe(4);            // 1 + 1 + 2
    expect(k.liquido).toBe(27);
    expect(k.ticket).toBe(50);            // (50 + 50) / 2
    expect(k.itensPorPedido).toBe(2);     // 4 / 2
    expect(k.compradoresUnicos).toBe(2);  // comprador 100 e 200
  });

  it('cancelado fica fora dos KPIs monetários mas conta no status de envio', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: null, total_amount: 50, shipping_status: 'shipped' }),
      venda({ id: 'b', order_id: 2, pack_id: null, status: 'cancelled', total_amount: 999, shipping_status: 'pending' }),
    ];
    const k = calcularKpisPedidos(agruparPorPedido(vendas));
    expect(k.pedidos).toBe(1);
    expect(k.liquido).toBe(9);
    expect(Object.values(k.porStatusEnvio).reduce((a, b) => a + b, 0)).toBe(2); // conta os 2 pedidos
  });

  it('pctRecompra = % dos pedidos de compradores com mais de 1 pedido no período', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: null, comprador_id: 100 }),
      venda({ id: 'b', order_id: 2, pack_id: null, comprador_id: 100 }),
      venda({ id: 'c', order_id: 3, pack_id: null, comprador_id: 200 }),
    ];
    const k = calcularKpisPedidos(agruparPorPedido(vendas));
    // comprador 100 tem 2 pedidos (recorrente) → 2 de 3 pedidos = 66.7%
    expect(k.pctRecompra).toBeCloseTo((2 / 3) * 100, 1);
  });
});

describe('nomeCurtoComprador', () => {
  it('mantém primeiro + segundo nome quando há dois', () => {
    expect(nomeCurtoComprador('Bárbara Bertoldi')).toBe('Bárbara Bertoldi');
    expect(nomeCurtoComprador('Patricia Neves Moreira Leite')).toBe('Patricia Neves');
  });
  it('pula preposições ao escolher o segundo nome', () => {
    expect(nomeCurtoComprador('Maria de Fatima Braga')).toBe('Maria Fatima');
    expect(nomeCurtoComprador('Ana da Silva')).toBe('Ana Silva');
  });
  it('nome único devolve só ele', () => {
    expect(nomeCurtoComprador('Madonna')).toBe('Madonna');
  });
  it('padroniza casing para Primeira Maiúscula nos dois nomes', () => {
    expect(nomeCurtoComprador('PATRICIA C')).toBe('Patricia C');
    expect(nomeCurtoComprador('sueli gonzaga')).toBe('Sueli Gonzaga');
    expect(nomeCurtoComprador('ROSELI Silva')).toBe('Roseli Silva');
    expect(nomeCurtoComprador('MARIA DE FATIMA BRAGA')).toBe('Maria Fatima');
  });
  it('normaliza espaços e devolve null para vazio/null', () => {
    expect(nomeCurtoComprador('  João   Pedro  Costa ')).toBe('João Pedro');
    expect(nomeCurtoComprador('')).toBeNull();
    expect(nomeCurtoComprador(null)).toBeNull();
    expect(nomeCurtoComprador(undefined)).toBeNull();
  });
});

describe('nomeExibicaoComprador', () => {
  it('prioriza nome real do comprador', () => {
    expect(nomeExibicaoComprador({ comprador_nome: 'Leonardo Teixeira', comprador_nick: 'leonardo.nick' })).toBe('Leonardo Teixeira');
  });

  it('usa nick quando nome real não veio do ML', () => {
    expect(nomeExibicaoComprador({ comprador_nome: null, comprador_nick: 'leonardo.nick' })).toBe('leonardo.nick');
  });

  it('usa travessão quando não há nome nem nick', () => {
    expect(nomeExibicaoComprador({ comprador_nome: null, comprador_nick: null })).toBe('—');
  });
});

describe('pedidoCasaBusca', () => {
  const p = agruparPorPedido([venda({
    order_id: 42, pack_id: null, comprador_nome: 'Leonardo Teixeira', comprador_nick: 'leonardo.nick',
    total_amount: 150.5, liquido: 130.25,
    itens: [item({ titulo: 'FITA CETIM VERMELHA', codigo: 'FC-001' })],
  })])[0];

  it('casa por nome do comprador (case-insensitive)', () => {
    expect(pedidoCasaBusca(p, 'leonardo')).toBe(true);
    expect(pedidoCasaBusca(p, 'LEONARDO teixeira')).toBe(true);
  });

  it('casa por título ou código do produto', () => {
    expect(pedidoCasaBusca(p, 'cetim')).toBe(true);
    expect(pedidoCasaBusca(p, 'FC-001')).toBe(true);
  });

  it('casa por número do pedido', () => {
    expect(pedidoCasaBusca(p, '42')).toBe(true);
  });

  it('casa por valor bruto ou líquido no formato exibido na tela (fmtBRLSemSimbolo)', () => {
    // bruto=150.5 → "150,50" na tela (não "150,5", que o usuário nunca vê)
    expect(pedidoCasaBusca(p, '150,50')).toBe(true);
    expect(pedidoCasaBusca(p, '130,25')).toBe(true);
  });

  it('casa valor com separador de milhar como exibido na tela', () => {
    const pack = agruparPorPedido([venda({ order_id: 1, pack_id: 1, total_amount: 1234.5, liquido: 1000 })])[0];
    expect(pedidoCasaBusca(pack, '1.234,50')).toBe(true);
  });

  it('casa pack pela chave (pack_id), não presente em orderIds', () => {
    const pack = agruparPorPedido([venda({ order_id: 10, pack_id: 999, itens: [item({ id: 'x' })] })])[0];
    expect(pack.chave).toBe('999');
    expect(pedidoCasaBusca(pack, '999')).toBe(true);
  });

  it('não casa termo ausente', () => {
    expect(pedidoCasaBusca(p, 'inexistente')).toBe(false);
  });

  it('busca vazia sempre casa', () => {
    expect(pedidoCasaBusca(p, '')).toBe(true);
  });
});
