import { describe, it, expect } from 'vitest';
import {
  mapearDevolucao, traduzirReason, normalizarRevisoes, playerDaConta, acoesDaConta, vezDe,
  revisaoPendente, colunasLidas, linhaParaUpsert, type ClaimML, type ExtrasClaim, type Leitura, type ReturnML,
} from '../devolucao';

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

  it('fechado_em vem de resolution.date_created (o instante do estorno), com o offset do ML', () => {
    // Payload real do claim 5553795965: abriu 03/08 15:32 (-04) e foi resolvido 17:16 do mesmo
    // dia — o pagamento 169615860668 foi estornado 17:16:41. O Dashboard atribui a devolução ao
    // período por essa data, não por date_created.
    const r = mapearDevolucao({
      id: 5553795965,
      type: 'returns',
      resource: 'order',
      resource_id: 2000017533182114,
      date_created: '2026-08-03T15:32:38.000-04:00',
      resolution: { reason: 'item_returned', date_created: '2026-08-03T17:16:36.000-04:00', closed_by: 'mediator' },
    });
    expect(r.aberto_em).toBe('2026-08-03T15:32:38.000-04:00');
    expect(r.fechado_em).toBe('2026-08-03T17:16:36.000-04:00');
  });

  it('claim ainda aberto (sem resolution) → fechado_em null', () => {
    const r = mapearDevolucao({ id: 5554029722, type: 'returns', status: 'opened', stage: 'dispute' });
    expect(r.fechado_em).toBeNull();
  });
});

const ACOES_VEND = [
  { action: 'send_message_to_complainant' }, { action: 'refund' }, { action: 'open_dispute' },
];
const CLAIM_REAL: ClaimML = {
  id: 5600661190, type: 'returns', stage: 'claim', status: 'opened', resource: 'order', resource_id: 2000018882300346,
  players: [
    { role: 'complainant', type: 'buyer', user_id: 483287448 },
    { role: 'respondent', type: 'seller', user_id: 1003820507, available_actions: ACOES_VEND },
  ],
};
const CONTA = '1003820507';
const DETALHE = { due_date: '2026-11-03T22:08:00.000-04:00', action_responsible: 'complainant', title: 'Devolução em preparação' };
const ok = <T,>(valor: T): Leitura<T> => ({ ok: true, valor });
const FALHA = { ok: false } as const;
const RET: ReturnML = { id: 169980422, status: 'shipped', status_money: 'retained', tracking: 'BR123', pedidos: [2000018882300346] };
const extras = (o: Partial<ExtrasClaim> = {}): ExtrasClaim => ({
  detalhe: ok(DETALHE), reputacao: ok('affected'), revisoes: ok([{ order_id: 1, seller_status: 'success' }]), ...o,
});

describe('player/ações da conta', () => {
  it('claim real: ações só do respondent, vez do comprador', () => {
    expect(playerDaConta(CLAIM_REAL, CONTA)?.role).toBe('respondent');
    const m = mapearDevolucao(CLAIM_REAL, null, CONTA);
    expect(m.acoes_pendentes).toHaveLength(3);
    const l = colunasLidas(CLAIM_REAL, ok(null), extras(), CONTA);
    expect(l.vez_de).toBe('comprador');
    expect(l.prazo).toBe('2026-11-03T22:08:00.000-04:00');
  });
  it('shipment: conta é receiver → ações do receiver', () => {
    const c: ClaimML = { id: 1, players: [
      { role: 'complainant', type: 'sender', user_id: 9, available_actions: [{ action: 'x' }] },
      { role: 'respondent', type: 'receiver', user_id: 7, available_actions: [{ action: 'a' }, { action: 'b' }] },
    ] };
    expect(acoesDaConta(c, '7').map((a) => a.action)).toEqual(['a', 'b']);
    expect(acoesDaConta(c, '55')).toEqual([]);
  });
  it('sem contaExternaId, mapearDevolucao agrupa todos os players (comportamento antigo)', () => {
    const c: ClaimML = { id: 1, players: [{ available_actions: [{ action: 'a' }] }, { available_actions: [{ action: 'b' }] }] };
    expect(mapearDevolucao(c).acoes_pendentes).toHaveLength(2);
  });
});

describe('vezDe', () => {
  it('papel igual → vendedor; mediator/internal → ml; outro → comprador; sem responsável → null', () => {
    expect(vezDe('respondent', 'respondent')).toBe('vendedor');
    expect(vezDe('mediator', 'respondent')).toBe('ml');
    expect(vezDe('internal', 'respondent')).toBe('ml');
    expect(vezDe('complainant', 'respondent')).toBe('comprador');
    expect(vezDe(null, 'respondent')).toBeNull();
  });
});

describe('normalizarRevisoes', () => {
  it('envelope da doc: carrinho com 2 pedidos, um com 2 resource_reviews (um pending)', () => {
    const r = normalizarRevisoes({ reviews: [
      { resource: 'order', resource_id: 111, resource_reviews: [{ seller_status: 'pending' }, { seller_status: 'failed' }] },
      { resource: 'order', resource_id: 222, resource_reviews: [{ seller_status: 'success' }] },
    ] });
    expect(r).toEqual([{ order_id: 111, seller_status: 'pending' }, { order_id: 222, seller_status: 'success' }]);
  });
  it('sem pending, vale o último', () => {
    expect(normalizarRevisoes({ reviews: [{ resource: 'order', resource_id: 1,
      resource_reviews: [{ seller_status: 'failed' }, { seller_status: 'success' }] }] })).toEqual([{ order_id: 1, seller_status: 'success' }]);
  });
  it('real 169980422', () => {
    expect(normalizarRevisoes({ reviews: [{ resource: 'order', resource_id: 2000018882300346, method: 'none',
      resource_reviews: [{ stage: 'closed', status: null, seller_status: 'success' }] }] }))
      .toEqual([{ order_id: 2000018882300346, seller_status: 'success' }]);
  });
  it('lixo → []', () => {
    expect(normalizarRevisoes(null)).toEqual([]);
    expect(normalizarRevisoes({})).toEqual([]);
  });
});

describe('revisaoPendente', () => {
  const rev = (s: string | null) => ok([{ order_id: 1, seller_status: s }]);
  const RESIDUAL = [{ action: 'return_review_ok', due_date: null, mandatory: false }];
  it('pending, sem ações → true', () => expect(revisaoPendente([], rev('pending'))).toBe(true));
  it.each([null, '', 'success', 'failed', 'claimed'])('%s → false', (s) => {
    expect(revisaoPendente([], rev(s))).toBe(false);
  });
  it('success com return_review_ok residual → false', () => expect(revisaoPendente(RESIDUAL, rev('success'))).toBe(false));
  it("'sem_review' com return_review_ok → true; sem ações → false", () => {
    expect(revisaoPendente(RESIDUAL, ok('sem_review' as const))).toBe(true);
    expect(revisaoPendente([], ok('sem_review' as const))).toBe(false);
  });
  it('leitura falha → decide pelas ações', () => expect(revisaoPendente(RESIDUAL, FALHA)).toBe(true));
});

describe('linhaParaUpsert (objeto final)', () => {
  const montar = (ret: Leitura<ReturnML | null>, ex: ExtrasClaim) =>
    linhaParaUpsert(mapearDevolucao(CLAIM_REAL, ret.ok ? ret.valor : null, CONTA),
      colunasLidas(CLAIM_REAL, ret, ex, CONTA, '2026-10-28T00:00:00Z'), ret.ok);
  it('tudo ok → colunas do return e enriquecido_em', () => {
    const o = montar(ok(RET), extras());
    expect(o).toMatchObject({ return_status: 'shipped', return_id: 169980422, rastreio: 'BR123',
      pedidos_devolucao: [2000018882300346], afeta_reputacao: 'affected', enriquecido_em: '2026-10-28T00:00:00Z' });
  });
  it('ret falhou → sem colunas do return (e sem enriquecido_em)', () => {
    const o = montar(FALHA, extras());
    for (const c of ['return_status', 'return_status_money', 'return_id', 'rastreio']) expect(o).not.toHaveProperty(c);
    expect(o).not.toHaveProperty('enriquecido_em');
    expect(o.vez_de).toBe('comprador');
  });
  it('reputação falhou → sem afeta_reputacao e sem enriquecido_em', () => {
    const o = montar(ok(RET), extras({ reputacao: FALHA }));
    expect(o).not.toHaveProperty('afeta_reputacao');
    expect(o).not.toHaveProperty('enriquecido_em');
    expect(o.return_status).toBe('shipped');
  });
  it('detalhe/revisões falhas → sem as respectivas colunas', () => {
    const o = montar(ok(RET), extras({ detalhe: FALHA, revisoes: FALHA }));
    for (const c of ['detalhe', 'prazo', 'vez_de', 'revisao_pendente', 'revisao_status']) expect(o).not.toHaveProperty(c);
  });
});
