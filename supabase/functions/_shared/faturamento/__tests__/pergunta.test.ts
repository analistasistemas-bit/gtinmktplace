import { describe, it, expect } from 'vitest';
import { mapearPergunta, naoRespondida } from '../pergunta';

describe('mapearPergunta', () => {
  it('mapeia pergunta não respondida', () => {
    const r = mapearPergunta({
      id: 123, text: 'Tem na cor azul?', status: 'UNANSWERED', item_id: 'MLB1',
      date_created: '2026-06-21T10:00:00Z', from: { id: 999 }, answer: null,
    });
    expect(r).toEqual({
      question_id: 123, item_id: 'MLB1', texto: 'Tem na cor azul?', status: 'UNANSWERED',
      resposta: null, respondida_em: null, comprador_id: 999, criada_em: '2026-06-21T10:00:00Z',
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
      resposta: null, respondida_em: null, comprador_id: null, criada_em: null,
    });
  });
});

describe('naoRespondida', () => {
  it('UNANSWERED → true; resto → false', () => {
    expect(naoRespondida('UNANSWERED')).toBe(true);
    expect(naoRespondida('ANSWERED')).toBe(false);
    expect(naoRespondida(null)).toBe(false);
  });
});
