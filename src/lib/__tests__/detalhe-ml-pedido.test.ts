import { describe, expect, it } from 'vitest';
import { agregarDetalheML, labelPagamento, type DetalheMLVenda } from '../detalhe-ml-pedido';

const linha = (o: Partial<DetalheMLVenda> = {}): DetalheMLVenda => ({
  id: 'v1', pagamentos: [], cupom: null, itens_ml: [], ...o,
});
const pgto = (o: Record<string, unknown> = {}) => ({
  id: 1, status: 'approved', payment_type: 'credit_card', payment_method_id: 'visa',
  installments: 3, shipping_cost: 0, date_approved: '2026-10-02T11:00:00.000-03:00', ...o,
});

describe('labelPagamento', () => {
  it('crédito com bandeira e parcelas', () => {
    expect(labelPagamento('credit_card', 'visa', 3)).toBe('Crédito Visa 3x');
    expect(labelPagamento('credit_card', 'master', 1)).toBe('Crédito Mastercard');
    expect(labelPagamento('credit_card', 'amex', 12)).toBe('Crédito Amex 12x');
  });
  it('demais meios', () => {
    expect(labelPagamento('bank_transfer', 'pix', 1)).toBe('Pix');
    expect(labelPagamento('bank_transfer', 'outro', 1)).toBe('Transferência');
    expect(labelPagamento('account_money', 'account_money', 1)).toBe('Saldo MP');
    expect(labelPagamento('ticket', 'bolbradesco', 1)).toBe('Boleto');
    expect(labelPagamento('digital_currency', 'consumer_credits', 1)).toBe('Mercado Crédito');
    expect(labelPagamento('prepaid_card', 'elo', 1)).toBe('Pré-pago');
    expect(labelPagamento('debit_card', 'elo', 1)).toBe('Débito Elo');
  });
});

describe('agregarDetalheML', () => {
  it('pedido simples: pagamento, aprovação, anúncio', () => {
    const d = agregarDetalheML([linha({
      pagamentos: [pgto()], itens_ml: [{ listing_type_id: 'gold_special' }],
    })]);
    expect(d.pagamentos).toEqual(['Crédito Visa 3x']);
    expect(d.aprovadoEm).toBe('2026-10-02T11:00:00.000-03:00');
    expect(d.tiposAnuncio).toEqual(['Clássico']);
    expect(d.freteComprador).toBe(0);
    expect(d.cupom).toBe(0);
  });

  it('dois payments aprovados viram "A + B" e somam o frete do comprador', () => {
    const d = agregarDetalheML([linha({
      pagamentos: [
        pgto({ id: 1, payment_type: 'account_money', payment_method_id: 'account_money', installments: 1, shipping_cost: 10, date_approved: '2026-10-02T12:00:00Z' }),
        pgto({ id: 2, shipping_cost: 5.5, date_approved: '2026-10-02T11:00:00Z' }),
      ],
    })]);
    expect(d.pagamentos).toEqual(['Saldo MP', 'Crédito Visa 3x']);
    expect(d.freteComprador).toBe(15.5);
    expect(d.aprovadoEm).toBe('2026-10-02T11:00:00Z');
  });

  it('ignora rejected/cancelled; refunded mostra o meio mas não soma frete', () => {
    const d = agregarDetalheML([linha({
      pagamentos: [
        pgto({ id: 1, status: 'rejected', payment_type: 'ticket', payment_method_id: 'bolbradesco', shipping_cost: 9 }),
        pgto({ id: 2, status: 'cancelled', payment_type: 'bank_transfer', payment_method_id: 'pix' }),
        pgto({ id: 3, status: 'refunded', shipping_cost: 4 }),
      ],
    })]);
    expect(d.pagamentos).toEqual(['Crédito Visa 3x']);
    expect(d.freteComprador).toBe(4);
  });

  it('dedupe por id entre orders do mesmo pack; sem id mantém', () => {
    const d = agregarDetalheML([
      linha({ id: 'a', pagamentos: [pgto({ id: 7, shipping_cost: 3 })] }),
      linha({ id: 'b', pagamentos: [pgto({ id: 7, shipping_cost: 3 }), pgto({ id: undefined }), pgto({ id: undefined })] }),
    ]);
    expect(d.freteComprador).toBe(3);
    // Mesmo meio em todas as orders: o rótulo aparece uma vez só.
    expect(d.pagamentos).toEqual(['Crédito Visa 3x']);
  });

  it('pack pago com o mesmo meio em cada order mostra o meio uma vez (pack 2000015295035439)', () => {
    const saldo = { payment_type: 'account_money', payment_method_id: 'account_money', installments: 1 };
    const d = agregarDetalheML([1, 2, 3, 4].map((id) => linha({ id: `v${id}`, pagamentos: [pgto({ id, ...saldo })] })));
    expect(d.pagamentos).toEqual(['Saldo MP']);
  });

  it('soma cupom e junta tipos de anúncio', () => {
    const d = agregarDetalheML([
      linha({ id: 'a', cupom: { amount: 2.5 }, itens_ml: [{ listing_type_id: 'gold_pro' }] }),
      linha({ id: 'b', cupom: { amount: 1 }, itens_ml: [{ listing_type_id: 'gold_pro' }, { listing_type_id: 'free' }, { listing_type_id: 'xpto' }] }),
    ]);
    expect(d.cupom).toBe(3.5);
    expect(d.tiposAnuncio).toEqual(['Premium', 'Grátis', 'xpto']);
  });

  it('tolera raw nulo e formatos inesperados', () => {
    const d = agregarDetalheML([
      linha({ pagamentos: null, cupom: null, itens_ml: null }),
      linha({ pagamentos: 'x', cupom: { amount: 'abc' }, itens_ml: [null, 3, {}] }),
      linha({ pagamentos: [null, 4, { status: 'approved' }] }),
    ]);
    expect(d.pagamentos).toEqual([]);
    expect(d.cupom).toBe(0);
    expect(d.tiposAnuncio).toEqual([]);
    expect(d.aprovadoEm).toBeNull();
  });
});
