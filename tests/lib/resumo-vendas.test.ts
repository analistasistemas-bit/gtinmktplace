import { describe, it, expect } from 'vitest';
import { calcularResumo, ratearLiquidoPorFrete, ehFaturavel, agruparPorPeriodo } from '@/lib/resumo-vendas';
import type { Venda, VendaItem } from '@/lib/faturamento';

const round2 = (n: number) => Math.round(n * 100) / 100;

const item = (over: Partial<VendaItem> = {}): VendaItem => ({
  id: 'i', ml_item_id: 'MLB1', variation_id: null, titulo: 't', codigo: null, cor: null,
  ean: null, quantity: 1, unit_price: 10, sale_fee: 1, is_publiai: true, ...over,
});

const venda = (over: Partial<Venda> = {}): Venda => ({
  id: 'x', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-20T00:00:00Z', date_created: '2026-06-20T00:00:00Z',
  comprador_nick: null, total_amount: 10, paid_amount: null, sale_fee_total: 1,
  frete_vendedor: null, liquido: 9, estorno: null, money_release_date: null,
  currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
  shipping_logistic: null, tracking_number: null, is_publiai: false, tem_devolucao: false,
  itens: [item()], ...over,
});

describe('ehFaturavel', () => {
  it('paid, partially_refunded e refunded são faturáveis; cancelled não', () => {
    expect(ehFaturavel('paid')).toBe(true);
    expect(ehFaturavel('partially_refunded')).toBe(true);
    expect(ehFaturavel('refunded')).toBe(true);
    expect(ehFaturavel('cancelled')).toBe(false);
    expect(ehFaturavel(null)).toBe(false);
  });
});

describe('calcularResumo', () => {
  it('inclui reembolso parcial no bruto (igual ML) e exclui cancelado', () => {
    const r = calcularResumo([
      venda({ id: 'a', order_id: 1, status: 'paid', total_amount: 776.83, liquido: 459.62,
        itens: [item({ id: 'a1', quantity: 46, unit_price: 776.83 / 46 })] }),
      venda({ id: 'b', order_id: 2, status: 'partially_refunded', total_amount: 25, liquido: 9.58,
        itens: [item({ id: 'b1', ml_item_id: 'MLB2', quantity: 2, unit_price: 12.5 })] }),
      venda({ id: 'c', order_id: 3, status: 'cancelled', total_amount: 999, liquido: 0,
        itens: [item({ id: 'c1', quantity: 9, unit_price: 111 })] }),
    ]);
    expect(r.bruto).toBe(801.83);   // 776,83 + 25  (cancelado fora)
    expect(r.pedidos).toBe(2);
    expect(r.unidades).toBe(48);    // 46 + 2
    expect(r.liquido).toBe(469.2);  // 459,62 + 9,58
    expect(r.descontos).toBe(round2(801.83 - 469.2));
  });

  it('soma estornos do campo estorno', () => {
    const r = calcularResumo([
      venda({ id: 'a', status: 'partially_refunded', total_amount: 25, liquido: 9.58, estorno: 12.5 }),
      venda({ id: 'b', status: 'paid', total_amount: 10, liquido: 9, estorno: null }),
    ]);
    expect(r.estornos).toBe(12.5);
  });

  it('agrega porItem por ml_item_id (valor = unit_price × qtd)', () => {
    const r = calcularResumo([
      venda({ id: 'a', itens: [item({ ml_item_id: 'MLB1', quantity: 2, unit_price: 10 })] }),
      venda({ id: 'b', itens: [item({ ml_item_id: 'MLB1', quantity: 1, unit_price: 10 })] }),
      venda({ id: 'c', itens: [item({ ml_item_id: 'MLB2', quantity: 3, unit_price: 5 })] }),
    ]);
    expect(r.porItem['MLB1']).toEqual({ unidades: 3, valor: 30 });
    expect(r.porItem['MLB2']).toEqual({ unidades: 3, valor: 15 });
  });

  it('markup só sobre vendas com custo; ticket = bruto/pedidos', () => {
    const resolver = (it: VendaItem) => (it.ml_item_id === 'COM' ? 4 : null);
    const r = calcularResumo([
      venda({ id: 'a', total_amount: 20, liquido: 16, itens: [item({ ml_item_id: 'COM', quantity: 2, unit_price: 10 })] }),
      venda({ id: 'b', total_amount: 50, liquido: 40, itens: [item({ ml_item_id: 'SEM', quantity: 1, unit_price: 50 })] }),
    ], resolver);
    expect(r.markup).toBeCloseTo(1.0, 5); // (16 - 8) / 8
    expect(r.lucro).toBe(8);
    expect(r.ticket).toBe(35); // (20 + 50) / 2
  });

  it('vazio → zeros e markup null', () => {
    const r = calcularResumo([]);
    expect(r).toMatchObject({ bruto: 0, liquido: 0, descontos: 0, estornos: 0, pedidos: 0, unidades: 0, ticket: 0, markup: null });
  });
});

describe('ratearLiquidoPorFrete', () => {
  // Pack real (CV20260605013927): o ML concentrou TODO o frete de R$18,87 no pagamento do
  // Búfalo, deixando-o com líquido 1,75 (markup -55%) e o Progresso com 16,56 (+115%). O rateio
  // por peso redistribui o frete entre os dois e corrige a atribuição (zero-soma).
  const buf = venda({
    id: 'buf', order_id: 2000017053071592, shipping_id: 47353836484, pack_id: 2000013639986103,
    total_amount: 24.64, liquido: 1.75, frete_vendedor: 18.87,
    itens: [item({ id: 'buf-i', ml_item_id: 'MLBBUF', codigo: '03099962', quantity: 2, unit_price: 12.32, sale_fee: 2.01 })],
  });
  const pro = venda({
    id: 'pro', order_id: 2000017053073394, shipping_id: 47353836484, pack_id: 2000013639986103,
    total_amount: 19.95, liquido: 16.56, frete_vendedor: 18.87,
    itens: [item({ id: 'pro-i', ml_item_id: 'MLBPRO', codigo: '01591851', quantity: 1, unit_price: 19.95, sale_fee: 3.39 })],
  });
  // Búfalo 58g × 2un = 116g; Progresso 112g × 1 = 112g.
  const pesoResolver = (it: VendaItem) =>
    it.codigo === '03099962' ? 58 : it.codigo === '01591851' ? 112 : null;

  it('redistribui o frete do pack por peso, recompondo o líquido (zero-soma)', () => {
    const m = ratearLiquidoPorFrete([buf, pro], pesoResolver);
    // frete: 18,87 × 116/228 = 9,60 (Búfalo) e × 112/228 = 9,27 (Progresso);
    // tarifa real do grupo = 44,59 − 18,87 − 18,31 = 7,41, rateada por bruto (4,09 / 3,32).
    expect(m.get('buf')!.liquido).toBeCloseTo(10.95, 2); // 24,64 − 4,09 − 9,60
    expect(m.get('pro')!.liquido).toBeCloseTo(7.36, 2);  // 19,95 − 3,32 − 9,27
    expect(m.get('buf')!.liquido + m.get('pro')!.liquido).toBeCloseTo(18.31, 2); // soma preservada
    expect(m.get('buf')!.frete).toBeCloseTo(9.6, 2);  // frete por peso, não os 18,87 inteiros
    expect(m.get('pro')!.frete).toBeCloseTo(9.27, 2);
  });

  it('sem peso cadastrado cai no rateio por valor, mas ainda corrige a distorção e mantém a soma', () => {
    const m = ratearLiquidoPorFrete([buf, pro]); // sem pesoResolver
    expect(m.get('buf')!.liquido).toBeGreaterThan(1.75); // Búfalo deixa de absorver o frete todo
    expect(m.get('buf')!.liquido + m.get('pro')!.liquido).toBeCloseTo(18.31, 2);
  });

  it('pedido fora de pack (sem grupo) não entra no mapa — fica com o líquido cru', () => {
    const m = ratearLiquidoPorFrete([
      venda({ id: 'solo', order_id: 7, shipping_id: 55, frete_vendedor: 6.55, liquido: 9 }),
    ], pesoResolver);
    expect(m.has('solo')).toBe(false);
  });

  it('grupo sem frete do vendedor fica cru (não inventa frete)', () => {
    const m = ratearLiquidoPorFrete([
      venda({ id: 'a', order_id: 1, shipping_id: 88, frete_vendedor: null, liquido: 5 }),
      venda({ id: 'b', order_id: 2, shipping_id: 88, frete_vendedor: null, liquido: 5 }),
    ], pesoResolver);
    expect(m.size).toBe(0);
  });

  it('calcularResumo aplica o líquido rateado por linha sem mudar o agregado', () => {
    const custoResolver = (it: VendaItem) =>
      it.codigo === '03099962' ? 1.95 : it.codigo === '01591851' ? 7.69 : null;
    const r = calcularResumo([buf, pro], custoResolver, pesoResolver);
    const lBuf = r.vendas.find((v) => v.orderId === 2000017053071592)!;
    const lPro = r.vendas.find((v) => v.orderId === 2000017053073394)!;
    expect(lBuf.liquido).toBeCloseTo(10.95, 2);
    expect(lBuf.retido).toBeCloseTo(13.69, 2); // 24,64 − 10,95
    expect(lPro.liquido).toBeCloseTo(7.36, 2);
    expect(r.liquido).toBeCloseTo(18.31, 2); // total do MP preservado (zero-soma)
    expect(r.bruto).toBeCloseTo(44.59, 2);
  });
});

// ─── Task-1: caixa/taxas/cobertura/margem ────────────────────────────────────

const AGORA = Date.parse('2026-06-15T00:00:00Z');

const itemT1 = (over: Partial<VendaItem> = {}): VendaItem => ({
  id: 'i1', ml_item_id: 'MLB1', variation_id: null, titulo: 'Fita', codigo: '001',
  cor: null, ean: '789', quantity: 1, unit_price: 10, sale_fee: 0, is_publiai: true, ...over,
});
const vendaT1 = (over: Partial<Venda> = {}): Venda => ({
  id: over.id ?? 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-10T12:00:00Z', date_created: '2026-06-10T12:00:00Z',
  comprador_nick: null, comprador_id: null, uf: null, cidade: null,
  total_amount: 100, paid_amount: null, sale_fee_total: 12, frete_vendedor: 8, liquido: 80,
  estorno: null, money_release_date: null, currency: 'BRL', shipping_id: null,
  shipping_status: null, shipping_substatus: null, shipping_logistic: null, tracking_number: null,
  is_publiai: true, tem_devolucao: false, itens: [itemT1()], ...over,
});

describe('calcularResumo — caixa/taxas/cobertura/margem', () => {
  it('separa líquido liberado (passado) de a liberar (futuro) e acha a próxima liberação', () => {
    const vendas = [
      vendaT1({ id: 'a', liquido: 80, money_release_date: '2026-06-12T00:00:00Z' }), // liberado
      vendaT1({ id: 'b', liquido: 50, money_release_date: '2026-06-20T00:00:00Z' }), // a liberar
      vendaT1({ id: 'c', liquido: 30, money_release_date: '2026-06-18T00:00:00Z' }), // a liberar (próxima)
    ];
    const r = calcularResumo(vendas, undefined, undefined, AGORA);
    expect(r.liberado).toBe(80);
    expect(r.aLiberar).toBe(80);
    expect(r.proximaLiberacao).toBe('2026-06-18T00:00:00Z');
  });

  it('soma comissão e frete só das faturáveis', () => {
    const vendas = [
      vendaT1({ id: 'a', sale_fee_total: 12, frete_vendedor: 8 }),
      vendaT1({ id: 'b', status: 'cancelled', sale_fee_total: 99, frete_vendedor: 99 }),
    ];
    const r = calcularResumo(vendas, undefined, undefined, AGORA);
    expect(r.comissao).toBe(12);
    expect(r.frete).toBe(8);
  });

  it('expõe cobertura de custo e margem (lucro ÷ líquido com custo)', () => {
    const resolver = (it: VendaItem) => (it.codigo === '001' ? 40 : null); // custo unit R$40
    const vendas = [
      vendaT1({ id: 'a', liquido: 80, itens: [itemT1({ codigo: '001', quantity: 1 })] }), // custo 40
      vendaT1({ id: 'b', liquido: 50, itens: [itemT1({ codigo: '999', quantity: 1 })] }), // sem custo
    ];
    const r = calcularResumo(vendas, resolver, undefined, AGORA);
    expect(r.totalVendas).toBe(2);
    expect(r.vendasComCusto).toBe(1);
    // lucro = 80 - 40 = 40 ; margem = 40 / 80 = 0.5
    expect(r.lucro).toBe(40);
    expect(r.margem).toBe(0.5);
  });

  it('margem null quando nenhuma venda tem custo', () => {
    const r = calcularResumo([vendaT1()], undefined, undefined, AGORA);
    expect(r.margem).toBeNull();
    expect(r.vendasComCusto).toBe(0);
  });
});

describe('calcularResumo — breakdown de taxas reconcilia com descontos', () => {
  it('frete é o residual (descontos − comissão), não a soma crua do frete_vendedor duplicado em pack', () => {
    // 2 pedidos do mesmo envio (pack): o ML grava o frete do envio inteiro em CADA pedido
    // (frete_vendedor 20 repetido). Somar cru daria 40; o frete efetivo é o residual do retido.
    const vendas = [
      venda({ id: 'a', order_id: 1, shipping_id: 555, total_amount: 100, liquido: 70, sale_fee_total: 10, frete_vendedor: 20 }),
      venda({ id: 'b', order_id: 2, shipping_id: 555, total_amount: 100, liquido: 78, sale_fee_total: 12, frete_vendedor: 20 }),
    ];
    const r = calcularResumo(vendas);
    expect(r.descontos).toBe(52); // bruto 200 − líquido 148 (rateio é zero-soma)
    expect(r.comissao).toBe(22); // 10 + 12 (sale_fee_total não duplica em pack)
    expect(r.frete).toBe(30); // residual 52 − 22 (NÃO 40 da soma crua de frete_vendedor)
    expect(r.comissao + r.frete).toBe(r.descontos); // breakdown SEMPRE fecha com o total exibido
  });

  it('frete nunca fica negativo quando a comissão excede o retido (ex.: reembolso)', () => {
    const vendas = [
      venda({ id: 'x', total_amount: 100, liquido: 99, sale_fee_total: 5 }), // descontos 1, comissão 5
    ];
    const r = calcularResumo(vendas);
    expect(r.frete).toBe(0); // max(0, 1 − 5)
  });
});

describe('agruparPorPeriodo', () => {
  it('agrupa líquido e bruto por dia, ordenado', () => {
    const itens = [
      { data: '2026-06-10T09:00:00Z', bruto: 100, liquido: 80 },
      { data: '2026-06-10T18:00:00Z', bruto: 50, liquido: 40 },
      { data: '2026-06-11T10:00:00Z', bruto: 30, liquido: 25 },
    ];
    const serie = agruparPorPeriodo(itens, 'dia');
    expect(serie).toHaveLength(2);
    expect(serie[0]).toMatchObject({ chave: '2026-06-10', rotulo: '10/06', bruto: 150, liquido: 120 });
    expect(serie[1]).toMatchObject({ chave: '2026-06-11', liquido: 25 });
  });
});
