import { describe, it, expect } from 'vitest';
import { mapearDevolucao, traduzirReason } from '../devolucao';

describe('traduzirReason', () => {
  it('traduz prefixos conhecidos', () => {
    expect(traduzirReason('PNR001')).toBe('Produto não recebido');
    expect(traduzirReason('PDD123')).toBe('Produto com defeito ou diferente');
  });
  it('reason desconhecido volta cru; null → null', () => {
    expect(traduzirReason('XYZ9')).toBe('XYZ9');
    expect(traduzirReason(null)).toBeNull();
  });
});

describe('mapearDevolucao', () => {
  it('mapeia claim com order, ações pendentes e return', () => {
    const r = mapearDevolucao(
      {
        id: 555, type: 'return', stage: 'claim', status: 'opened', reason_id: 'PNR001',
        resource: 'order', resource_id: 2000003508419013, date_created: '2026-06-21T00:00:00Z',
        players: [
          { available_actions: [{ action: 'send_money_back', due_date: '2026-06-25T00:00:00Z', mandatory: true }] },
          { available_actions: [{ action: 'review_return', due_date: null, mandatory: false }] },
        ],
      },
      { status: 'shipped', status_money: 'retained', subtype: 'return_total' },
    );
    expect(r.claim_id).toBe(555);
    expect(r.order_id).toBe(2000003508419013);
    expect(r.type).toBe('return');
    expect(r.reason_texto).toBe('Produto não recebido');
    expect(r.return_status).toBe('shipped');
    expect(r.return_status_money).toBe('retained');
    expect(r.acoes_pendentes).toEqual([
      { action: 'send_money_back', due_date: '2026-06-25T00:00:00Z', mandatory: true },
      { action: 'review_return', due_date: null, mandatory: false },
    ]);
  });
  it('sem resource order → order_id null; sem ações → null', () => {
    const r = mapearDevolucao({ id: 9, type: 'mediations', resource: 'payment', resource_id: 1, players: [] });
    expect(r.order_id).toBeNull();
    expect(r.acoes_pendentes).toBeNull();
  });
});
