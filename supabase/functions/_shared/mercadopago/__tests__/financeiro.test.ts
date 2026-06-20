import { describe, it, expect } from 'vitest';
import { agregarFinanceiro, montarCustoPorPagamento, type PagamentoMP } from '../financeiro';

function pag(p: Partial<PagamentoMP> & { id: number }): PagamentoMP {
  return p as PagamentoMP;
}

const CONTA = 1003820507;
const INTERVALO = { desde: '2026-06-01T00:00:00.000Z', ate: '2026-06-30T23:59:59.000Z', contaId: CONTA };

describe('agregarFinanceiro — só vendas da conta (collector_id)', () => {
  it('exclui pagamentos em que a conta NÃO é a recebedora (compras/terceiros)', () => {
    const pagamentos = [
      // venda real (conta é collector)
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        transaction_amount: 33, transaction_details: { net_received_amount: 16.1 } }),
      // compra/terceiro: collector é outro → NÃO entra
      pag({ id: 2, collector_id: 999999, date_approved: '2026-06-18T09:00:00.000Z',
        transaction_amount: 3999.9, transaction_details: { net_received_amount: 3773.67 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO);
    expect(r.bruto).toBe(33);
    expect(r.liquido).toBe(16.1);
    expect(r.pagamentos).toBe(1);
  });

  it('exclui o pagamento de frete (marketplace_shipment) — não é venda', () => {
    const pagamentos = [
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        description: 'Fita Cetim', transaction_amount: 12.65,
        transaction_details: { net_received_amount: 10.5 } }),
      // frete da mesma venda → fora
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        description: 'marketplace_shipment', transaction_amount: 8.99,
        transaction_details: { net_received_amount: 8.99 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO);
    expect(r.bruto).toBe(12.65);
    expect(r.liquido).toBe(10.5);
    expect(r.pagamentos).toBe(1);
  });

  it('soma bruto/líquido/estornos das vendas da conta e calcula descontos', () => {
    const pagamentos = [
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        transaction_amount: 12.65, transaction_amount_refunded: 0,
        transaction_details: { net_received_amount: 4.35 } }),
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-06-20T09:00:00.000Z',
        transaction_amount: 25, transaction_amount_refunded: 0,
        transaction_details: { net_received_amount: 10.7 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO);
    expect(r.bruto).toBe(37.65);
    expect(r.liquido).toBe(15.05);
    expect(r.descontos).toBe(22.6);
    expect(r.estornos).toBe(0);
    expect(r.pagamentos).toBe(2);
  });

  it('devolve a lista de vendas (uma por pagamento) com bruto/líquido/retido/estorno', () => {
    const pagamentos = [
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        description: 'Fita Cetim', transaction_amount: 12.65, transaction_amount_refunded: 0,
        transaction_details: { net_received_amount: 4.35 } }),
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-06-20T09:00:00.000Z',
        description: 'Linha 120m', transaction_amount: 25, transaction_amount_refunded: 5,
        transaction_details: { net_received_amount: 10.7 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO);
    expect(r.vendas).toHaveLength(2);
    // ordenado por data desc — a venda mais recente vem primeiro
    expect(r.vendas[0]).toEqual({
      id: '2', data: '2026-06-20T09:00:00.000Z', descricao: 'Linha 120m',
      bruto: 25, liquido: 10.7, retido: 14.3, estorno: 5, custo: null,
    });
    expect(r.vendas[1]).toEqual({
      id: '1', data: '2026-06-17T09:00:00.000Z', descricao: 'Fita Cetim',
      bruto: 12.65, liquido: 4.35, retido: 8.3, estorno: 0, custo: null,
    });
  });

  it('anexa o custo por pagamento quando fornecido (markup), null quando ausente', () => {
    const pagamentos = [
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        transaction_amount: 25, transaction_details: { net_received_amount: 18 } }),
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-06-18T09:00:00.000Z',
        transaction_amount: 30, transaction_details: { net_received_amount: 20 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO, { '1': 9.9 });
    const v1 = r.vendas.find((v) => v.id === '1');
    const v2 = r.vendas.find((v) => v.id === '2');
    expect(v1?.custo).toBe(9.9);
    expect(v2?.custo).toBeNull();
  });

  it('não inclui frete nem compras de terceiros na lista de vendas', () => {
    const r = agregarFinanceiro([
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        transaction_amount: 33, transaction_details: { net_received_amount: 16.1 } }),
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-06-17T09:00:00.000Z',
        description: 'marketplace_shipment', transaction_amount: 8.99,
        transaction_details: { net_received_amount: 8.99 } }),
      pag({ id: 3, collector_id: 999, date_approved: '2026-06-17T09:00:00.000Z',
        transaction_amount: 999, transaction_details: { net_received_amount: 900 } }),
    ], INTERVALO);
    expect(r.vendas.map((v) => v.id)).toEqual(['1']);
  });

  it('compara collector_id como número mesmo vindo string', () => {
    const r = agregarFinanceiro(
      [pag({ id: 1, collector_id: String(CONTA), date_approved: '2026-06-10T00:00:00.000Z',
        transaction_amount: 50, transaction_details: { net_received_amount: 40 } })],
      INTERVALO,
    );
    expect(r.pagamentos).toBe(1);
    expect(r.bruto).toBe(50);
  });

  it('ignora vendas da conta fora do intervalo (por date_approved)', () => {
    const pagamentos = [
      pag({ id: 1, collector_id: CONTA, date_approved: '2026-06-10T00:00:00.000Z',
        transaction_amount: 50, transaction_details: { net_received_amount: 40 } }),
      pag({ id: 2, collector_id: CONTA, date_approved: '2026-05-10T00:00:00.000Z',
        transaction_amount: 999, transaction_details: { net_received_amount: 900 } }),
    ];
    const r = agregarFinanceiro(pagamentos, INTERVALO);
    expect(r.bruto).toBe(50);
    expect(r.pagamentos).toBe(1);
  });

  it('retorna zeros quando não há vendas da conta', () => {
    const r = agregarFinanceiro(
      [pag({ id: 1, collector_id: 42, date_approved: '2026-06-10T00:00:00.000Z',
        transaction_amount: 100, transaction_details: { net_received_amount: 90 } })],
      INTERVALO,
    );
    expect(r).toEqual({ bruto: 0, liquido: 0, descontos: 0, estornos: 0, pagamentos: 0, vendas: [] });
  });
});

describe('montarCustoPorPagamento', () => {
  it('usa o custo da variação (R$) × quantidade quando há variação', () => {
    const r = montarCustoPorPagamento(
      { '111': { mlItemId: 'MLB1', mlVariationId: 'V1', quantidade: 2 } },
      { V1: 0.77896 },
      { MLB1: 9.99 },
    );
    expect(r).toEqual({ '111': 1.56 });
  });

  it('cai no custo por item quando a venda não tem variação', () => {
    const r = montarCustoPorPagamento(
      { '222': { mlItemId: 'MLB2', mlVariationId: null, quantidade: 3 } },
      {},
      { MLB2: 1.5 },
    );
    expect(r).toEqual({ '222': 4.5 });
  });

  it('ignora pagamento sem custo (variação e item ausentes, zero ou negativo)', () => {
    const r = montarCustoPorPagamento(
      {
        '1': { mlItemId: 'SEM', mlVariationId: 'X', quantidade: 1 },
        '2': { mlItemId: 'ZERO', mlVariationId: null, quantidade: 3 },
        '3': { mlItemId: 'NEG', mlVariationId: null, quantidade: 1 },
      },
      {},
      { ZERO: 0, NEG: -10 },
    );
    expect(r).toEqual({});
  });
});
