import { describe, expect, it } from 'vitest';
import { extrairPalavrasChave, parseVisitasJanela, validarItemIds } from '../sonar.ts';

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

describe('validarItemIds — trust boundary da pulse-sonar-visitas (teto 20 = amostra D4)', () => {
  it('aceita lista válida e deduplica', () => {
    expect(validarItemIds(['MLB1', 'MLB2', 'MLB1'])).toEqual(['MLB1', 'MLB2']);
  });
  it('rejeita vazio, >20, não-array e item não-string/vazio', () => {
    expect(validarItemIds([])).toBeNull();
    expect(validarItemIds(Array.from({ length: 21 }, (_, i) => `MLB${i}`))).toBeNull();
    expect(validarItemIds('MLB1')).toBeNull();
    expect(validarItemIds(['MLB1', 42])).toBeNull();
    expect(validarItemIds(['MLB1', ' '])).toBeNull();
  });
});
