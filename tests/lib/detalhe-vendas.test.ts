import { describe, it, expect } from 'vitest';
import { montarDetalheVendas } from '@/lib/detalhe-vendas';
import { calcularResumo } from '@/lib/resumo-vendas';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import type { Venda, VendaItem } from '@/lib/faturamento';
import type { CustoResolver, AliquotaResolver, PesoResolver } from '@/lib/resumo-vendas';

/** CustoResolver por ml_item_id → custo unitário (R$). */
const custoPorItem = (mapa: Record<string, number>): CustoResolver =>
  (it) => (it.ml_item_id && mapa[it.ml_item_id] != null ? mapa[it.ml_item_id] : null);

function item(over: Partial<VendaItem> = {}): VendaItem {
  return {
    id: 'it1', ml_item_id: 'MLB1', variation_id: null, titulo: 'App Item',
    codigo: '00445975', cor: null, ean: '7891521360659', quantity: 1,
    unit_price: 10, sale_fee: 0, is_publiai: true, ...over,
  };
}

function venda(over: Partial<Venda> = {}): Venda {
  return {
    id: 'v1', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
    date_closed: '2026-06-15T00:00:00Z', date_created: null, comprador_nick: null,
    total_amount: 10, paid_amount: null, sale_fee_total: 0, frete_vendedor: null,
    liquido: null, estorno: null, money_release_date: null, currency: 'BRL',
    shipping_id: null, shipping_status: null, shipping_substatus: null,
    shipping_logistic: null, tracking_number: null, is_publiai: true,
    tem_devolucao: false, itens: [item()], ...over,
  };
}

const externo = (over: Partial<VendaItem> = {}): VendaItem => item({
  id: 'itx', ml_item_id: 'MLBX', titulo: 'Externo', codigo: null, ean: null,
  is_publiai: false, ...over,
});

describe('montarDetalheVendas (fonte única ml_vendas — ADR-0038)', () => {
  it('compõe app + externo, total e pedidos batendo com as vendas faturáveis', () => {
    const vendas = [
      venda({ id: 'v1', total_amount: 90, itens: [item({ quantity: 2, unit_price: 45 })] }),
      venda({ id: 'v2', order_id: 2, is_publiai: false, total_amount: 30, itens: [externo({ quantity: 3, unit_price: 10 })] }),
    ];
    const r = montarDetalheVendas(vendas);

    expect(r.total).toBe(120);
    expect(r.pedidos).toBe(2);

    expect(r.app.valor).toBe(90);
    expect(r.app.unidades).toBe(2);
    expect(r.app.linhas[0].titulo).toBe('App Item');
    expect(r.app.linhas[0].codigo).toBe('00445975');
    expect(r.app.linhas[0].ean).toBe('7891521360659');
    expect(r.app.linhas[0].pctTotal).toBeCloseTo(75);

    expect(r.externo.valor).toBe(30);
    expect(r.externo.linhas[0].titulo).toBe('Externo');
    expect(r.externo.linhas[0].codigo).toBeNull();
    expect(r.externo.linhas[0].ean).toBeNull();
    expect(r.externo.pctTotal).toBeCloseTo(25);
  });

  it('agrupa vendas do mesmo anúncio (ml_item_id) numa única linha', () => {
    const vendas = [
      venda({ id: 'v1', total_amount: 10, itens: [item({ quantity: 1, unit_price: 10 })] }),
      venda({ id: 'v2', order_id: 2, total_amount: 20, itens: [item({ id: 'it2', quantity: 2, unit_price: 10 })] }),
    ];
    const r = montarDetalheVendas(vendas);
    expect(r.app.linhas).toHaveLength(1);
    expect(r.app.linhas[0].unidades).toBe(3);
    expect(r.app.linhas[0].valor).toBe(30);
  });

  it('ignora pedidos cancelados (não entram no total nem nos pedidos)', () => {
    const vendas = [
      venda({ id: 'v1', total_amount: 50 }),
      venda({ id: 'v2', order_id: 2, status: 'cancelled', total_amount: 999 }),
    ];
    const r = montarDetalheVendas(vendas);
    expect(r.total).toBe(50);
    expect(r.pedidos).toBe(1);
  });

  it('conta reembolso parcial como venda bruta (espelha "Vendas brutas" do ML)', () => {
    // Caso Búfalo: pedido partially_refunded de R$25 que a fonte antiga (API ML) não trazia.
    const vendas = [
      venda({ id: 'v1', total_amount: 100 }),
      venda({ id: 'v2', order_id: 2, status: 'partially_refunded', total_amount: 25, estorno: 12.5 }),
    ];
    const r = montarDetalheVendas(vendas);
    expect(r.total).toBe(125);
    expect(r.pedidos).toBe(2);
  });

  it('usa o id do anúncio como título quando o item não tem título', () => {
    const vendas = [venda({ itens: [item({ titulo: null })] })];
    const r = montarDetalheVendas(vendas);
    expect(r.app.linhas[0].titulo).toBe('MLB1');
  });

  it('sem vendas → tudo zerado', () => {
    const r = montarDetalheVendas([]);
    expect(r.total).toBe(0);
    expect(r.pedidos).toBe(0);
    expect(r.app.linhas).toHaveLength(0);
    expect(r.externo.linhas).toHaveLength(0);
  });

  it('sem resolver de custo → markup/lucro null (compatível com chamada antiga)', () => {
    const r = montarDetalheVendas([venda({ total_amount: 100, liquido: 80, itens: [item({ quantity: 1, unit_price: 100 })] })]);
    expect(r.app.linhas[0].markup).toBeNull();
    expect(r.app.linhas[0].lucro).toBeNull();
    expect(r.app.markup).toBeNull();
    expect(r.app.lucro).toBe(0);
  });
});

describe('montarDetalheVendas — markup e lucro por produto', () => {
  it('calcula markup e lucro por produto usando líquido (não bruto)', () => {
    const r = montarDetalheVendas(
      [venda({ total_amount: 100, liquido: 80, itens: [item({ quantity: 2, unit_price: 50 })] })],
      custoPorItem({ MLB1: 10 }),
    );
    const l = r.app.linhas.find((x) => x.id === 'MLB1')!;
    expect(l.lucro).toBe(60);        // líquido 80 − custo (10×2)=20 → 60
    expect(l.markup).toBeCloseTo(3);  // 60 / 20
  });

  it('produto sem custo cadastrado → markup e lucro null', () => {
    const r = montarDetalheVendas(
      [venda({ total_amount: 100, liquido: 80, itens: [item({ quantity: 1, unit_price: 100 })] })],
      custoPorItem({}),
    );
    const l = r.app.linhas.find((x) => x.id === 'MLB1')!;
    expect(l.markup).toBeNull();
    expect(l.lucro).toBeNull();
  });

  it('seção externa (fora do PubliAI) não tem markup/lucro', () => {
    const r = montarDetalheVendas(
      [venda({ id: 'vx', order_id: 9, is_publiai: false, total_amount: 50, liquido: 40, itens: [externo({ quantity: 1, unit_price: 50 })] })],
      custoPorItem({}),
    );
    expect(r.externo.linhas).toHaveLength(1);
    expect(r.externo.linhas[0].markup).toBeNull();
    expect(r.externo.linhas[0].lucro).toBeNull();
  });

  it('média PONDERADA agrega várias vendas do mesmo produto', () => {
    const r = montarDetalheVendas(
      [
        venda({ id: 'v1', order_id: 1, total_amount: 100, liquido: 90, itens: [item({ id: 'a', quantity: 1, unit_price: 100 })] }),
        venda({ id: 'v2', order_id: 2, total_amount: 100, liquido: 50, itens: [item({ id: 'b', quantity: 1, unit_price: 100 })] }),
      ],
      custoPorItem({ MLB1: 20 }),
    );
    const l = r.app.linhas.find((x) => x.id === 'MLB1')!;
    // Σ líquido = 140, Σ custo = 20×2 = 40 → lucro 100, markup 100/40 = 2,5
    expect(l.lucro).toBe(100);
    expect(l.markup).toBeCloseTo(2.5);
  });

  it('subtotal da seção: soma de lucro e markup ponderado', () => {
    const r = montarDetalheVendas(
      [
        venda({ id: 'v1', order_id: 1, total_amount: 100, liquido: 80, itens: [item({ id: 'a', ml_item_id: 'M1', quantity: 1, unit_price: 100 })] }),
        venda({ id: 'v2', order_id: 2, total_amount: 100, liquido: 60, itens: [item({ id: 'b', ml_item_id: 'M2', quantity: 1, unit_price: 100 })] }),
      ],
      custoPorItem({ M1: 10, M2: 30 }),
    );
    // M1: liq80/custo10 ; M2: liq60/custo30 → Σliq140 Σcusto40 → lucro100, markup 2,5
    expect(r.app.lucro).toBe(100);
    expect(r.app.markup).toBeCloseTo(2.5);
  });

  it('desconta imposto no markup/lucro (ADR-0055) e bate com o KPI (calcularResumo)', () => {
    // Regressão da divergência Detalhe (65%) vs KPI (27%): com o mesmo aliquotaResolver, o markup
    // do Detalhe de vendas tem que ser IGUAL ao do KPI — ambos descontam imposto do líquido.
    const aliq: AliquotaResolver = () => 10; // 10% sobre o valor de venda
    const v = venda({ total_amount: 100, liquido: 80, itens: [item({ ml_item_id: 'MLB1', quantity: 1, unit_price: 100 })] });
    const custo = custoPorItem({ MLB1: 40 });

    const d = montarDetalheVendas([v], custo, undefined, aliq);
    const l = d.app.linhas.find((x) => x.id === 'MLB1')!;
    // líquido 80 − imposto 10 (100×10%) − custo 40 = 30 → markup 0,75
    expect(l.lucro).toBe(30);
    expect(l.markup).toBeCloseTo(0.75);

    const kpi = calcularResumo([v], custo, undefined, Date.parse('2026-07-03T00:00:00Z'), aliq);
    expect(d.app.markup as number).toBeCloseTo(kpi.markup as number, 6);
    expect(d.app.lucro).toBe(kpi.lucro);
  });

  it('markup por produto BATE com o Detalhe do pedido em pack de 1 order_id por item (regressão fita 03096963)', () => {
    // Pack real 2000013532233489: 3 order_ids (um por produto), frete R$26,40 repetido em cada linha.
    // A fita é leve+barata → no rateio de frete por peso quase não paga frete. Ratear o líquido POR
    // LINHA dava à fita o líquido inteiro do seu order_id (markup ~843%); poolar por pack e redistribuir
    // por valor (igual ao agruparPorPedido) traz o markup para o valor canônico (~592%).
    const cola = item({ id: 'i_cola', ml_item_id: 'MB_COLA', codigo: '02841053', quantity: 2, unit_price: 37.9 });
    const fita = item({ id: 'i_fita', ml_item_id: 'MB_FITA', codigo: '03096963', quantity: 1, unit_price: 12.55 });
    const linha = item({ id: 'i_linha', ml_item_id: 'MB_LINHA', codigo: '02543842', quantity: 1, unit_price: 45.1 });
    const base = (over: Partial<Venda>): Venda => venda({
      pack_id: 999, shipping_id: 77, frete_vendedor: 26.4, status: 'paid', ...over,
    });
    const vendas = [
      base({ id: 'o_cola', order_id: 208, total_amount: 75.8, sale_fee_total: 12.88, itens: [cola] }),
      base({ id: 'o_fita', order_id: 162, total_amount: 12.55, sale_fee_total: 2.13, itens: [fita] }),
      base({ id: 'o_linha', order_id: 164, total_amount: 45.1, sale_fee_total: 7.44, itens: [linha] }),
    ];
    const custo = custoPorItem({ MB_COLA: 15.57, MB_FITA: 0.86, MB_LINHA: 21.12 });
    // Fita leve, cola/linha pesadas → rateio de frete por peso deixa quase todo o frete na cola/linha.
    const peso: PesoResolver = (it) => ({ MB_COLA: 1000, MB_FITA: 50, MB_LINHA: 300 }[it.ml_item_id ?? ''] ?? null);
    const aliq: AliquotaResolver = () => 16; // importado

    const d = montarDetalheVendas(vendas, custo, peso, aliq);
    const [pedido] = agruparPorPedido(vendas, custo, peso, undefined, aliq);

    // Invariante: o markup por produto no Detalhe de vendas é o MESMO do Detalhe do pedido.
    for (const it of pedido.itens) {
      const linhaDetalhe = d.app.linhas.find((l) => l.id === it.ml_item_id)!;
      expect(linhaDetalhe.markup).toBeCloseTo(it.markup as number, 6);
    }
    // E o total da seção continua batendo com o líquido do pack (redistribuição não cria/some líquido).
    const somaLiquidoItens = pedido.itens.reduce((s, it) => s + it.liquido, 0);
    expect(somaLiquidoItens).toBeCloseTo(pedido.liquido, 2);
  });

  it('usa líquido RATEADO em pack com frete compartilhado', () => {
    const r = montarDetalheVendas(
      [
        venda({ id: 'A', order_id: 1, shipping_id: 7, total_amount: 100, liquido: 50, frete_vendedor: 40, sale_fee_total: 10,
          itens: [item({ id: 'a', ml_item_id: 'MA', quantity: 1, unit_price: 100 })] }),
        venda({ id: 'B', order_id: 2, shipping_id: 7, total_amount: 100, liquido: 90, frete_vendedor: 40, sale_fee_total: 10,
          itens: [item({ id: 'b', ml_item_id: 'MB', quantity: 1, unit_price: 100 })] }),
      ],
      custoPorItem({ MA: 10, MB: 10 }),
    );
    // Rateio do frete de pack equilibra: líquido A=70, B=70 (não o cru 50/90).
    // markup de cada = (70 − 10) / 10 = 6 (sem rateio seriam 4 e 8).
    const ma = r.app.linhas.find((l) => l.id === 'MA')!;
    const mb = r.app.linhas.find((l) => l.id === 'MB')!;
    expect(ma.markup).toBeCloseTo(6);
    expect(mb.markup).toBeCloseTo(6);
  });
});
