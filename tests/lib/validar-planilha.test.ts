import { describe, it, expect } from 'vitest';
import { colunasFaltando, COLUNAS_OBRIGATORIAS_PLANILHA } from '@/lib/validar-planilha';
import { COLUNAS_OBRIGATORIAS } from '../../supabase/functions/_shared/types';

const TODAS = [...COLUNAS_OBRIGATORIAS_PLANILHA];

describe('colunasFaltando', () => {
  it('sem faltar quando todas presentes', () => {
    expect(colunasFaltando(TODAS)).toEqual([]);
  });

  it('case-insensitive (cabeçalho em minúsculas)', () => {
    expect(colunasFaltando(TODAS.map((c) => c.toLowerCase()))).toEqual([]);
  });

  it('ignora espaços ao redor', () => {
    expect(colunasFaltando(TODAS.map((c) => `  ${c} `))).toEqual([]);
  });

  it('retorna as ausentes', () => {
    const headers = TODAS.filter((c) => c !== 'GTIN' && c !== 'CUSTO');
    expect(colunasFaltando(headers)).toEqual(['GTIN', 'CUSTO']);
  });

  it('colunas extras não atrapalham', () => {
    expect(colunasFaltando([...TODAS, 'COLUNA_EXTRA'])).toEqual([]);
  });

  it('cabeçalho vazio acusa todas como faltando', () => {
    expect(colunasFaltando([])).toEqual(TODAS);
  });

  // A lista do cliente é um espelho da do backend. Se ela ficar para trás, o operador sobe a
  // planilha inteira com o check verde e só leva o erro na edge function — foi o que aconteceria
  // com ORIGEM (ADR-0107). Comparar com a fonte trava a dessincronização de vez.
  it('espelha exatamente COLUNAS_OBRIGATORIAS do backend', () => {
    expect([...COLUNAS_OBRIGATORIAS_PLANILHA]).toEqual([...COLUNAS_OBRIGATORIAS]);
  });

  it('inclui ORIGEM (imposto por origem, ADR-0107)', () => {
    expect(COLUNAS_OBRIGATORIAS_PLANILHA).toContain('ORIGEM');
    expect(colunasFaltando(TODAS.filter((c) => c !== 'ORIGEM'))).toEqual(['ORIGEM']);
  });
});
