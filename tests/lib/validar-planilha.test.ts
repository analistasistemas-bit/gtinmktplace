import { describe, it, expect } from 'vitest';
import { colunasFaltando, COLUNAS_OBRIGATORIAS_PLANILHA } from '@/lib/validar-planilha';

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

  it('exige as 14 colunas do backend', () => {
    expect(COLUNAS_OBRIGATORIAS_PLANILHA).toHaveLength(14);
    expect(COLUNAS_OBRIGATORIAS_PLANILHA).toContain('PESO_GRAMAS');
    expect(COLUNAS_OBRIGATORIAS_PLANILHA).toContain('DESCRICAO_DETALHADO');
  });
});
