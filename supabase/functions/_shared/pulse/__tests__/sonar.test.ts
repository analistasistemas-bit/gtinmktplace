import { describe, expect, it } from 'vitest';
import { extrairPalavrasChave, parseFichasBusca, parseVisitasJanela, resumoPrecos } from '../sonar.ts';

describe('parseFichasBusca', () => {
  it('extrai id/nome/domain e ignora entradas sem id', () => {
    const json = { results: [
      { id: 'MLB60128399', name: 'Tecido Oxford Liso 10m', domain_id: 'MLB-FABRICS' },
      { name: 'sem id' },
    ] };
    expect(parseFichasBusca(json)).toEqual([
      { product_id: 'MLB60128399', nome: 'Tecido Oxford Liso 10m', domain_id: 'MLB-FABRICS' },
    ]);
  });
  it('devolve [] para corpo inválido', () => {
    expect(parseFichasBusca(null)).toEqual([]);
    expect(parseFichasBusca({})).toEqual([]);
  });
});

describe('parseVisitasJanela', () => {
  it('extrai total e série diária', () => {
    const json = { total_visits: 42, results: [
      { date: '2026-07-30T00:00:00Z', total: 2 },
      { date: '2026-08-08T00:00:00Z', total: 5 },
    ] };
    expect(parseVisitasJanela(json)).toEqual({ total: 42, por_dia: [
      { data: '2026-07-30', total: 2 },
      { data: '2026-08-08', total: 5 },
    ] });
  });
  it('null quando o corpo não tem total_visits numérico', () => {
    expect(parseVisitasJanela({ message: 'forbidden' })).toBeNull();
  });
});

describe('extrairPalavrasChave', () => {
  it('conta termos normalizados sem stopwords e respeita o limite', () => {
    const nomes = ['Tecido Oxford Liso 10m', 'Tecido Oxford Estampado', 'Rolo de Tecido'];
    const r = extrairPalavrasChave(nomes, 2);
    expect(r[0]).toEqual({ termo: 'tecido', contagem: 3 });
    expect(r[1]).toEqual({ termo: 'oxford', contagem: 2 });
    expect(r).toHaveLength(2);
  });
});

describe('resumoPrecos', () => {
  it('min/mediana/max com mediana de lista par = média dos centrais', () => {
    expect(resumoPrecos([10, 30, 20, 40])).toEqual({ min: 10, mediana: 25, max: 40 });
  });
  it('min/mediana/max com mediana de lista ímpar = valor central', () => {
    expect(resumoPrecos([10, 30, 20])).toEqual({ min: 10, mediana: 20, max: 30 });
  });
  it('null para lista vazia', () => {
    expect(resumoPrecos([])).toBeNull();
  });
});
