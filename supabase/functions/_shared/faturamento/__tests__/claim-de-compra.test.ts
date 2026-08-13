// Claims do ML incluem os que a conta abriu como COMPRADORA. Sem discriminar, uma compra da
// empresa vira "devolução de venda" (25 casos na base em 2026-08-13) e, pior, o sync-devolucao
// reprocessa o pedido pelo pipeline de upsertVenda e recria a linha de venda que a migration
// tinha apagado.
import { describe, it, expect } from 'vitest';
import { ehClaimDeCompra } from '../devolucao';

const CONTA = '1003820507';

describe('ehClaimDeCompra', () => {
  it('claim de venda: a conta é o seller', () => {
    expect(ehClaimDeCompra({
      players: [
        { role: 'complainant', type: 'buyer', user_id: 9757132 },
        { role: 'respondent', type: 'seller', user_id: 1003820507 },
      ],
    }, CONTA)).toBe(false);
  });

  it('claim de COMPRA: a conta é o buyer e outro é o seller', () => {
    // Caso real: claim 5551739423, memória RAM comprada pela AVILBV.
    expect(ehClaimDeCompra({
      players: [
        { role: 'complainant', type: 'buyer', user_id: 1003820507 },
        { role: 'respondent', type: 'seller', user_id: 226994730 },
      ],
    }, CONTA)).toBe(true);
  });

  it('devolução de venda: a conta recebe o produto de volta (receiver) e NÃO é compra', () => {
    // sender/receiver são papéis logísticos e se invertem na devolução — usá-los para decidir
    // classificaria toda devolução de venda como compra.
    expect(ehClaimDeCompra({
      players: [
        { role: 'complainant', type: 'receiver', user_id: 1003820507 },
        { role: 'respondent', type: 'sender', user_id: 427677111 },
      ],
    }, CONTA)).toBe(false);
  });

  it('seller vence buyer quando a conta aparece nos dois papéis', () => {
    expect(ehClaimDeCompra({
      players: [
        { role: 'complainant', type: 'buyer', user_id: 1003820507 },
        { role: 'respondent', type: 'seller', user_id: 1003820507 },
      ],
    }, CONTA)).toBe(false);
  });

  it('sem evidência nos players, não decide — não é compra (conservador)', () => {
    expect(ehClaimDeCompra({ players: [{ role: 'complainant', type: 'internal', user_id: 46622406 }] }, CONTA)).toBe(false);
    expect(ehClaimDeCompra({ players: null }, CONTA)).toBe(false);
    expect(ehClaimDeCompra({}, CONTA)).toBe(false);
  });

  it('sem conta conhecida, não decide', () => {
    expect(ehClaimDeCompra({
      players: [{ role: 'complainant', type: 'buyer', user_id: 1003820507 }],
    }, null)).toBe(false);
  });

  it('compara como texto — o ML alterna number e string no user_id', () => {
    expect(ehClaimDeCompra({
      players: [
        { role: 'complainant', type: 'buyer', user_id: '1003820507' },
        { role: 'respondent', type: 'seller', user_id: 999 },
      ],
    }, CONTA)).toBe(true);
  });
});
