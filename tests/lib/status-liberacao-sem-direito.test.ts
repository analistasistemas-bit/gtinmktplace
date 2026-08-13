// A régua de liberação decidia só por data, ignorando o status de pagamento — então um pedido
// devolvido, cuja data de liberação já passou, aparecia como "liberado" na aba Devolvidos
// (code-review-v11, M4). Enquanto ela responder isso, cada consumidor novo herda o defeito.
import { describe, it, expect } from 'vitest';
import { statusLiberacao, labelStatusLiberacao } from '@/lib/status-liberacao';

const PASSADO = '2026-08-01T00:00:00Z';
const FUTURO = '2099-01-01T00:00:00Z';
const AGORA = Date.parse('2026-08-12T00:00:00Z');

describe('statusLiberacao com faturavel', () => {
  it('pedido não faturável não tem direito a liberação, mesmo com data no passado', () => {
    expect(statusLiberacao(
      { money_release_date: PASSADO, sacado_em: null, faturavel: false }, AGORA,
    )).toBe('sem_direito');
  });

  it('não faturável marcado como sacado ainda é "sem direito" — a marca é o dado errado', () => {
    expect(statusLiberacao(
      { money_release_date: PASSADO, sacado_em: '2026-08-05T00:00:00Z', faturavel: false }, AGORA,
    )).toBe('sem_direito');
  });

  it('faturável segue a régua de sempre', () => {
    expect(statusLiberacao({ money_release_date: PASSADO, sacado_em: null, faturavel: true }, AGORA)).toBe('liberado');
    expect(statusLiberacao({ money_release_date: FUTURO, sacado_em: null, faturavel: true }, AGORA)).toBe('aliberar');
    expect(statusLiberacao({ money_release_date: PASSADO, sacado_em: PASSADO, faturavel: true }, AGORA)).toBe('sacado');
    expect(statusLiberacao({ money_release_date: null, sacado_em: null, faturavel: true }, AGORA)).toBe('sem_data');
  });

  it('sem informar faturavel, o comportamento anterior é preservado', () => {
    expect(statusLiberacao({ money_release_date: PASSADO, sacado_em: null }, AGORA)).toBe('liberado');
    expect(statusLiberacao({ money_release_date: FUTURO, sacado_em: null }, AGORA)).toBe('aliberar');
  });

  it('tem rótulo próprio, para a tela não dizer "liberado" num pedido devolvido', () => {
    expect(labelStatusLiberacao('sem_direito')).toBe('sem direito');
  });
});
