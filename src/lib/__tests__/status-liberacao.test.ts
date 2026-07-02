import { describe, expect, it } from 'vitest';
import { statusLiberacao, labelStatusLiberacao } from '../status-liberacao';

const agora = Date.parse('2026-07-02T12:00:00Z');

describe('statusLiberacao', () => {
  it('classifica data futura como a liberar', () => {
    expect(statusLiberacao({ money_release_date: '2026-07-03T00:00:00Z', sacado_em: null }, agora)).toBe('aliberar');
  });

  it('classifica data passada sem saque como liberado', () => {
    expect(statusLiberacao({ money_release_date: '2026-07-01T00:00:00Z', sacado_em: null }, agora)).toBe('liberado');
  });

  it('classifica qualquer registro com sacado_em como sacado', () => {
    expect(statusLiberacao({
      money_release_date: '2026-07-01T00:00:00Z',
      sacado_em: '2026-07-02T10:00:00Z',
    }, agora)).toBe('sacado');
  });

  it('classifica sem data e sem saque como sem_data', () => {
    expect(statusLiberacao({ money_release_date: null, sacado_em: null }, agora)).toBe('sem_data');
  });

  it('mantem pack com membro sem data fora de liberado depois que a ultima data passa', () => {
    expect(statusLiberacao({
      money_release_date: '2026-07-03T00:00:00Z',
      sacado_em: null,
      temMembrosSemDataLiberacao: true,
    }, agora)).toBe('aliberar');

    expect(statusLiberacao({
      money_release_date: '2026-07-01T00:00:00Z',
      sacado_em: null,
      temMembrosSemDataLiberacao: true,
    }, agora)).toBe('sem_data');
  });

  it('expoe rotulos da UI', () => {
    expect(labelStatusLiberacao('aliberar')).toBe('a liberar');
    expect(labelStatusLiberacao('liberado')).toBe('liberado');
    expect(labelStatusLiberacao('sacado')).toBe('sacado');
    expect(labelStatusLiberacao('sem_data')).toBe('—');
  });
});
