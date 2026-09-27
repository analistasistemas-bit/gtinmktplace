import { describe, it, expect } from 'vitest';
import { agruparPorPedido } from '@/lib/pedidos-faturamento';
import { agregarPorSku } from '@/lib/vendas-sku';
import { serieDoSku } from '@/lib/sku-dossie';
import { intervalosBRT } from '@/lib/calendario-brt';
import type { Venda, VendaItem } from '@/lib/faturamento';
import type { CustoResolver } from '@/lib/resumo-vendas';

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

const custo: CustoResolver = () => 4; // R$ 4 por unidade (custo atual → estimado)
const agrupar = (vs: Venda[]) => agruparPorPedido(vs, custo);
// Semanas BRT de 14/09 e 21/09 (segundas, 03:00Z).
const IVS = intervalosBRT('2026-09-14T03:00:00.000Z', '2026-09-27T02:59:59.999Z', 'semana', new Date('2026-10-01T12:00:00Z'));
const S1 = { desde: '2026-09-14T03:00:00.000Z', ate: '2026-09-21T02:59:59.999Z' };

describe('serieDoSku', () => {
  it('série: bate com agregarPorSku no mesmo intervalo; preço médio ponderado; intervalo sem venda sem preço', () => {
    const vendas = [
      venda({ id: 'a', order_id: 1, date_closed: '2026-09-15T12:00:00Z', total_amount: 20, liquido: 18,
        itens: [item({ id: 'i1', codigo: 'A', quantity: 2, unit_price: 10 })] }),
      // domingo 23:59 BRT → ainda semana 1 (fim meio-aberto)
      venda({ id: 'b', order_id: 2, date_closed: '2026-09-21T02:59:00Z', total_amount: 13, liquido: 12,
        itens: [item({ id: 'i2', codigo: 'A', quantity: 1, unit_price: 13 })] }),
      // outro SKU na semana 1 — fora da série
      venda({ id: 'c', order_id: 3, date_closed: '2026-09-16T12:00:00Z', total_amount: 50, liquido: 45,
        itens: [item({ id: 'i3', codigo: 'B', quantity: 1, unit_price: 50 })] }),
      // domingo 23:59 BRT da semana anterior — fora de todos os intervalos
      venda({ id: 'd', order_id: 4, date_closed: '2026-09-14T02:59:00Z', total_amount: 99, liquido: 90,
        itens: [item({ id: 'i4', codigo: 'A', quantity: 9, unit_price: 11 })] }),
    ];
    const serie = serieDoSku({ vendas, agrupar, codigos: ['A'], intervalos: IVS, catalogo: new Map(), ordensDevolvidas: new Set() });
    expect(serie).toHaveLength(2);
    const [s1, s2] = serie;
    expect(s1.intervalo).toBe(IVS[0]);
    // bruto 2×10 + 13 = 33; lucro (18 − 8) + (12 − 4) = 18; preço 33 ÷ 3 = 11
    expect(s1).toMatchObject({ unidades: 3, bruto: 33, lucro: 18, fonteCusto: 'estimado', precoMedio: 11, precoMin: 10, precoMax: 13 });
    // oráculo: agregarPorSku da Fatia 1 no mesmo recorte
    const oraculo = agregarPorSku(agrupar(vendas.slice(0, 2)), S1, new Map(), new Set());
    expect(oraculo).toHaveLength(1);
    expect(s1.bruto).toBe(oraculo[0].acc.bruto);
    expect(s1.lucro).toBe(oraculo[0].m.lucro);
    expect(s2).toMatchObject({ unidades: 0, bruto: 0, lucro: null, precoMedio: null, precoMin: null, precoMax: null });
  });

  it('pack com o SKU e outro produto: o SKU recebe só a fatia dele (frete rateado igual à aba Vendas)', () => {
    // Pack 9, mesmo envio, frete R$ 10 rateado por valor (sem peso): A 30/50 → 6, B 20/50 → 4.
    const vendas = [
      venda({ id: 'a', order_id: 1, pack_id: 9, shipping_id: 77, frete_vendedor: 10, date_closed: '2026-09-15T12:00:00Z',
        total_amount: 30, sale_fee_total: 3, itens: [item({ id: 'i1', codigo: 'A', quantity: 3, unit_price: 10 })] }),
      venda({ id: 'b', order_id: 2, pack_id: 9, shipping_id: 77, frete_vendedor: 10, date_closed: '2026-09-15T12:00:00Z',
        total_amount: 20, sale_fee_total: 2, itens: [item({ id: 'i2', codigo: 'B', quantity: 1, unit_price: 20 })] }),
    ];
    const [s1] = serieDoSku({ vendas, agrupar, codigos: ['A'], intervalos: IVS, catalogo: new Map(), ordensDevolvidas: new Set() });
    // líquido A = 30 − 3 − 6 = 21; custo 3 × 4 = 12; lucro 9
    expect(s1).toMatchObject({ unidades: 3, bruto: 30, lucro: 9, precoMedio: 10, precoMin: 10, precoMax: 10 });
    const oraculo = agregarPorSku(agrupar(vendas), S1, new Map(), new Set()).find((l) => l.codigo === 'A')!;
    expect(oraculo.acc.liquido).toBe(21);
    expect(s1.lucro).toBe(oraculo.m.lucro);
  });
});
