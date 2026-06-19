import { describe, it, expect } from 'vitest';
import { agregarFinanceiro, type PagamentoMP } from '../financeiro';

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
    expect(r).toEqual({ bruto: 0, liquido: 0, descontos: 0, estornos: 0, pagamentos: 0 });
  });
});
