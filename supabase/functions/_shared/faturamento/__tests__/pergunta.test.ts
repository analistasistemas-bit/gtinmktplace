import { describe, it, expect } from 'vitest';
import { mapearPergunta, naoRespondida, preservarComprador } from '../pergunta';

describe('mapearPergunta', () => {
  it('mapeia pergunta não respondida', () => {
    const r = mapearPergunta({
      id: 123, text: 'Tem na cor azul?', status: 'UNANSWERED', item_id: 'MLB1',
      date_created: '2026-06-21T10:00:00Z', from: { id: 999, nickname: 'CLIENTE_01' }, answer: null,
    });
    expect(r).toEqual({
      question_id: 123, item_id: 'MLB1', texto: 'Tem na cor azul?', status: 'UNANSWERED',
      resposta: null, respondida_em: null, comprador_id: 999, comprador_nick: 'CLIENTE_01', criada_em: '2026-06-21T10:00:00Z',
    });
  });
  it('mapeia pergunta respondida com answer', () => {
    const r = mapearPergunta({
      id: 5, text: 'Qual o prazo?', status: 'ANSWERED', item_id: 'MLB2',
      date_created: '2026-06-20T00:00:00Z', from: { id: 1 },
      answer: { text: '2 dias úteis', status: 'ACTIVE', date_created: '2026-06-20T01:00:00Z' },
    });
    expect(r.resposta).toBe('2 dias úteis');
    expect(r.respondida_em).toBe('2026-06-20T01:00:00Z');
    expect(r.status).toBe('ANSWERED');
  });
  it('campos ausentes viram defaults seguros', () => {
    const r = mapearPergunta({ id: 7 });
    expect(r).toEqual({
      question_id: 7, item_id: null, texto: '', status: 'UNKNOWN',
      resposta: null, respondida_em: null, comprador_id: null, comprador_nick: null, criada_em: null,
    });
  });
});

describe('preservarComprador', () => {
  it('payload sem `from` mantém o comprador já salvo', () => {
    expect(preservarComprador({ comprador_id: null, comprador_nick: null }, { comprador_id: 42, comprador_nick: 'MARIA_01' }))
      .toEqual({ comprador_id: 42, comprador_nick: 'MARIA_01' });
  });
  it('id novo do ML tem precedência sobre o salvo', () => {
    expect(preservarComprador({ comprador_id: 9, comprador_nick: null }, { comprador_id: 42, comprador_nick: 'MARIA_01' }))
      .toEqual({ comprador_id: 9, comprador_nick: 'MARIA_01' });
  });
  it('linha nova sem `from` fica null (nick resolvido depois via /users)', () => {
    expect(preservarComprador({ comprador_id: null, comprador_nick: null }, null))
      .toEqual({ comprador_id: null, comprador_nick: null });
  });
});

describe('naoRespondida', () => {
  it('UNANSWERED → true; resto → false', () => {
    expect(naoRespondida('UNANSWERED')).toBe(true);
    expect(naoRespondida('ANSWERED')).toBe(false);
    expect(naoRespondida(null)).toBe(false);
  });
});
