import { describe, it, expect } from 'vitest';
import { topProdutos, vendasPorUf, calendarioCaixa, montarAtencao } from '../cockpit';
import type { Venda } from '../faturamento';
import type { VendaResumo } from '../resumo-vendas';
import type { PublicadoItem } from '../publicados';

const venda = (over: Partial<Venda>): Venda => ({
  id: 'x', order_id: 1, pack_id: null, status: 'paid', status_detail: null,
  date_closed: '2026-06-20T00:00:00Z', date_created: '2026-06-20T00:00:00Z',
  comprador_id: null, comprador_nick: null, comprador_nome: null, total_amount: 0, paid_amount: null,
  sale_fee_total: 0, frete_vendedor: null, liquido: null, estorno: null, money_release_date: null, sacado_em: null, sacado_por: null,
  currency: 'BRL', shipping_id: null, shipping_status: null, shipping_substatus: null,
  shipping_logistic: null, tracking_number: null, is_publiai: false, tem_devolucao: false,
  uf: null, cidade: null, itens: [], atualizado_em: '2026-06-20T00:00:00Z', ...over,
});

describe('topProdutos', () => {
  const pub = (over: Partial<PublicadoItem>) => ({ familiaId: 'f', mlItemId: 'M', titulo: 't', ...over }) as PublicadoItem;

  it('usa o título de Publicados e soma todos os MLBs da família (uma cor por MLB)', () => {
    const top = topProdutos(
      [pub({ familiaId: 'fita', mlItemId: 'AMARELO', titulo: 'Fita Natalina Luxo', mlItemIdsUP: ['AMARELO', 'VERMELHO'] })],
      { AMARELO: { unidades: 1, valor: 30 }, VERMELHO: { unidades: 4, valor: 120.5 } },
    );
    expect(top).toEqual([{ mlItemId: 'AMARELO', titulo: 'Fita Natalina Luxo', unidades: 5, valor: 150.5 }]);
  });

  it('ordena por valor desc, limita a 5 e ignora anúncio sem venda', () => {
    const ids = ['A', 'B', 'C', 'D', 'E', 'F'];
    const porItem = Object.fromEntries(ids.map((id, i) => [id, { unidades: 1, valor: (i + 1) * 10 }]));
    const top = topProdutos([...ids, 'SEM_VENDA'].map((id) => pub({ familiaId: id, mlItemId: id })), porItem);
    expect(top.map((p) => p.mlItemId)).toEqual(['F', 'E', 'D', 'C', 'B']);
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
  id: 'v', orderId: 1, pedidoChave: '1', data: '2026-06-20', dataLiberacao: null, descricao: null, codigo: null,
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
    const a = montarAtencao({ aRevisar: 1, comProblema: 1, pausados: 1, erros: 2, errosDestino: '/relatorio/9', perguntas: 1, devolucoes: 3 });
    expect(a).toEqual([
      { chave: 'revisar', label: '1 lote a revisar', destino: '/revisao' },
      { chave: 'problema', label: '1 anúncio com problema', destino: '/publicados?status=problema' },
      { chave: 'pausado', label: '1 anúncio pausado', destino: '/publicados?status=pausado' },
      { chave: 'erros', label: '2 erros de publicação', destino: '/relatorio/9' },
      { chave: 'perguntas', label: '1 pergunta sem resposta', destino: '/faturamento?aba=perguntas' },
      { chave: 'devolucoes', label: '3 devoluções abertas', destino: '/faturamento?aba=devolucoes' },
    ]);
  });
  it('vazio quando tudo zerado', () => {
    expect(montarAtencao({ aRevisar: 0, comProblema: 0, pausados: 0, erros: 0, errosDestino: '/x', perguntas: 0, devolucoes: 0 })).toEqual([]);
  });
});
