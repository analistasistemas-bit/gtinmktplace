import { describe, it, expect } from 'vitest';
import { topProdutos, vendasPorUf, calendarioCaixa, montarAtencao } from '../cockpit';
import type { Venda, VendaItem } from '../faturamento';
import type { VendaResumo } from '../resumo-vendas';

const item = (over: Partial<VendaItem>): VendaItem => ({
  id: 'i', ml_item_id: 'M', variation_id: null, titulo: 't', codigo: null, cor: null,
  ean: null, quantity: 1, unit_price: 10, sale_fee: 1, is_publiai: true, ...over,
});
const venda = (over: Partial<Venda>): Venda => ({
  id: 'x', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-20T00:00:00Z', date_created: '2026-06-20T00:00:00Z',
  comprador_id: null, comprador_nick: null, comprador_nome: null, total_amount: 0, paid_amount: null,
  sale_fee_total: 0, frete_vendedor: null, liquido: null, estorno: null, money_release_date: null,
  currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
  shipping_logistic: null, tracking_number: null, is_publiai: false, tem_devolucao: false,
  uf: null, cidade: null, itens: [], ...over,
});

describe('topProdutos', () => {
  it('soma unidades/valor por anúncio, ordena por valor desc e ignora não faturável', () => {
    const top = topProdutos([
      venda({ itens: [item({ ml_item_id: 'M', titulo: 'Linha', quantity: 2, unit_price: 10 })] }), // 20
      venda({ itens: [item({ ml_item_id: 'N', titulo: 'Botão', quantity: 1, unit_price: 100 })] }), // 100
      venda({ status: 'cancelled', itens: [item({ ml_item_id: 'M', quantity: 9, unit_price: 99 })] }), // ignora
    ]);
    expect(top.map((p) => p.mlItemId)).toEqual(['N', 'M']);
    expect(top[1]).toMatchObject({ titulo: 'Linha', unidades: 2, valor: 20 });
  });
});

describe('vendasPorUf', () => {
  it('conta pedidos faturáveis por UF, ignora sem UF e não faturável', () => {
    const r = vendasPorUf([
      venda({ uf: 'SP' }), venda({ uf: 'SP' }), venda({ uf: 'RJ' }),
      venda({ uf: null }), venda({ status: 'cancelled', uf: 'MG' }),
    ]);
    expect(r).toEqual({ SP: 2, RJ: 1 });
  });
});

const vr = (over: Partial<VendaResumo>): VendaResumo => ({
  id: 'v', orderId: 1, data: '2026-06-20', dataLiberacao: null, descricao: null, codigo: null,
  bruto: 0, liquido: 0, retido: 0, estorno: 0, custo: null, ...over,
});

describe('calendarioCaixa', () => {
  it('agrupa liberações futuras por dia e ordena pela mais próxima', () => {
    const agora = Date.parse('2026-06-20T00:00:00Z');
    const cal = calendarioCaixa([
      vr({ dataLiberacao: '2026-06-25T00:00:00Z', liquido: 100 }),
      vr({ dataLiberacao: '2026-06-25T12:00:00Z', liquido: 50 }),
      vr({ dataLiberacao: '2026-06-22T00:00:00Z', liquido: 30 }),
      vr({ dataLiberacao: '2026-06-10T00:00:00Z', liquido: 999 }), // passado: fora
      vr({ dataLiberacao: null, liquido: 1 }),
    ], 6, agora);
    expect(cal).toEqual([
      { data: '2026-06-22', total: 30 },
      { data: '2026-06-25', total: 150 },
    ]);
  });
});

describe('montarAtencao', () => {
  it('inclui só o que é > 0, com singular/plural e destinos', () => {
    const a = montarAtencao({ aRevisar: 1, comProblema: 0, erros: 2, errosDestino: '/relatorio/9', perguntas: 0, devolucoes: 3 });
    expect(a).toEqual([
      { chave: 'revisar', label: '1 lote a revisar', destino: '/revisao' },
      { chave: 'erros', label: '2 erros de publicação', destino: '/relatorio/9' },
      { chave: 'devolucoes', label: '3 devoluções abertas', destino: '/faturamento' },
    ]);
  });
  it('vazio quando tudo zerado', () => {
    expect(montarAtencao({ aRevisar: 0, comProblema: 0, erros: 0, errosDestino: '/x', perguntas: 0, devolucoes: 0 })).toEqual([]);
  });
});
