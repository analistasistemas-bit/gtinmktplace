import { describe, it, expect } from 'vitest';
import { devolucoesAbertas, devolucoesConcluidasNoPeriodo, dataNoPeriodo, type Devolucao } from '@/lib/devolucoes';

/** Os 8 claims reais da conta do Diego (lidos do banco em 2026-08-06), que foram a base do
 *  diagnóstico. Mantidos como estão: qualquer mudança de critério passa a ser medida contra
 *  dados de produção, não contra exemplo inventado. */
const base = (over: Partial<Devolucao>): Devolucao => ({
  id: String(over.claim_id ?? '0'),
  claim_id: 0,
  order_id: null,
  stage: 'claim',
  status: 'closed',
  type: 'returns',
  reason_texto: 'Produto com defeito ou diferente',
  valor_em_jogo: null,
  return_status: null,
  return_status_money: 'refunded',
  acoes_pendentes: null,
  aberto_em: null,
  fechado_em: null,
  ...over,
});

const REAIS: Devolucao[] = [
  base({ claim_id: 5531142374, type: 'mediations', aberto_em: '2026-06-20T18:04:00+00:00', fechado_em: '2026-06-22T18:30:24+00:00', return_status: 'delivered', valor_estornado: 12.5 }),
  base({ claim_id: 5543509880, aberto_em: '2026-07-14T21:23:00+00:00', fechado_em: '2026-07-15T18:27:00+00:00', return_status: 'delivered', valor_estornado: 35.76 }),
  base({ claim_id: 5544792393, aberto_em: '2026-07-17T00:48:00+00:00', fechado_em: '2026-07-22T16:56:00+00:00', return_status: 'delivered', valor_estornado: 59.99 }),
  base({ claim_id: 5548692520, aberto_em: '2026-07-24T14:34:00+00:00', fechado_em: '2026-07-29T18:51:00+00:00', return_status: null, return_status_money: null, valor_estornado: 40.65 }),
  base({ claim_id: 5550524900, aberto_em: '2026-07-28T12:36:00+00:00', fechado_em: '2026-07-30T14:10:00+00:00', return_status: null, return_status_money: null, valor_estornado: 31.82 }),
  base({ claim_id: 5551126982, aberto_em: '2026-07-29T13:47:00+00:00', fechado_em: '2026-07-29T13:47:00+00:00', return_status: null, return_status_money: null, valor_estornado: 28.2 }),
  base({ claim_id: 5552400113, aberto_em: '2026-07-31T18:58:00+00:00', fechado_em: '2026-08-03T19:27:27+00:00', return_status: 'shipped', valor_estornado: 70.5 }),
  base({ claim_id: 5553795965, aberto_em: '2026-08-03T19:32:38+00:00', fechado_em: '2026-08-03T21:16:36+00:00', return_status: 'shipped', valor_estornado: 56.16 }),
];

const AGOSTO = { desde: '2026-08-01T03:00:00.000Z', ate: '2026-08-06T23:59:59.999Z' };

describe('devolucoesConcluidasNoPeriodo', () => {
  it('atribui a devolução ao mês em que o dinheiro saiu, não ao da abertura', () => {
    // O claim 5552400113 abriu 31/07 e só foi reembolsado (R$ 70,50) em 03/08. Filtrando por
    // aberto_em ele caía em julho e agosto mostrava "1 devolução · R$ 56,16"; o mês que perdeu
    // o dinheiro perdeu os dois estornos.
    const r = devolucoesConcluidasNoPeriodo(REAIS, AGOSTO.desde, AGOSTO.ate);
    expect(r.qtd).toBe(2);
    expect(r.valor).toBeCloseTo(126.66, 2);
  });

  it('exclui mediação e claim sem reembolso confirmado', () => {
    // Julho inteiro: das 6 com fechado_em em julho, só 2 são `returns` + `refunded`.
    const r = devolucoesConcluidasNoPeriodo(REAIS, '2026-07-01T03:00:00.000Z', '2026-08-01T02:59:59.999Z');
    expect(r.qtd).toBe(2);
    expect(r.valor).toBeCloseTo(95.75, 2); // 35,76 + 59,99
  });

  it('linha antiga sem fechado_em cai no aberto_em (backfill parcial)', () => {
    const semBackfill = [base({ claim_id: 1, aberto_em: '2026-08-04T12:00:00+00:00', fechado_em: null, valor_estornado: 10 })];
    expect(devolucoesConcluidasNoPeriodo(semBackfill, AGOSTO.desde, AGOSTO.ate).qtd).toBe(1);
  });

  it('borda: offset +00:00 do banco vs Z da janela no mesmo instante', () => {
    const naBorda = [base({ claim_id: 2, fechado_em: '2026-08-01T03:00:00+00:00', valor_estornado: 5 })];
    expect(devolucoesConcluidasNoPeriodo(naBorda, AGOSTO.desde, AGOSTO.ate).qtd).toBe(1);
  });
});

describe('dataNoPeriodo (card e aba Devoluções usam a mesma)', () => {
  it('resolvida entra pelo estorno; em curso, pela abertura', () => {
    const resolvida = REAIS.find((d) => d.claim_id === 5552400113)!;
    expect(dataNoPeriodo(resolvida)).toBe('2026-08-03T19:27:27+00:00');
    expect(dataNoPeriodo(base({ claim_id: 4, aberto_em: '2026-08-04T01:48:00+00:00', fechado_em: null })))
      .toBe('2026-08-04T01:48:00+00:00');
  });
});

describe('devolucoesAbertas', () => {
  it('não conta devolução já fechada que o ML deixou com ações pendentes', () => {
    // Estado real do claim 5550524900 às 11h37 de 06/08: fechado e reembolsado no ML ("Devolução
    // finalizada"), mas ainda com available_actions de review vencendo em 06/08 — era o
    // "1 devolução aberta" do card Precisa de atenção.
    const fechadaComAcoes = [base({
      claim_id: 5550524900,
      status: 'closed',
      acoes_pendentes: [
        { action: 'return_review_fail', due_date: null, mandatory: false },
        { action: 'return_review_ok', due_date: '2026-08-06T00:00:00+00:00', mandatory: true },
      ],
    })];
    expect(devolucoesAbertas(fechadaComAcoes)).toBe(0);
  });

  it('conta devolução aberta que pede ação do vendedor', () => {
    const aberta = [base({
      claim_id: 5554029722,
      status: 'opened',
      stage: 'dispute',
      return_status: 'label_generated',
      return_status_money: 'retained',
      acoes_pendentes: [{ action: 'allow_return', due_date: null, mandatory: true }],
    })];
    expect(devolucoesAbertas(aberta)).toBe(1);
  });

  it('aberta sem ação pendente não entra (nada a fazer)', () => {
    expect(devolucoesAbertas([base({ claim_id: 3, status: 'opened', acoes_pendentes: null })])).toBe(0);
  });
});
