import { describe, it, expect } from 'vitest';
import { parseAnomalias, totalAnomalias } from '../../src/lib/tipos-dominio';

describe('parseAnomalias', () => {
  it('null/undefined → todos os contadores vazios', () => {
    expect(parseAnomalias(null)).toEqual({
      codigos_duplicados: [],
      filhos_orfaos: [],
      familias_sem_filho: [],
    });
    expect(parseAnomalias(undefined)).toEqual({
      codigos_duplicados: [],
      filhos_orfaos: [],
      familias_sem_filho: [],
    });
  });

  it('jsonb completo é mapeado preservando os códigos', () => {
    const a = parseAnomalias({
      codigos_duplicados: ['00000101'],
      filhos_orfaos: ['00000999', '00000888'],
      familias_sem_filho: ['00000200'],
    });
    expect(a.codigos_duplicados).toEqual(['00000101']);
    expect(a.filhos_orfaos).toEqual(['00000999', '00000888']);
    expect(a.familias_sem_filho).toEqual(['00000200']);
  });

  it('campo ausente ou não-array vira lista vazia (defensivo)', () => {
    const a = parseAnomalias({ codigos_duplicados: 'oops', filhos_orfaos: 3 });
    expect(a.codigos_duplicados).toEqual([]);
    expect(a.filhos_orfaos).toEqual([]);
    expect(a.familias_sem_filho).toEqual([]);
  });
});

describe('totalAnomalias', () => {
  it('soma os três contadores', () => {
    expect(
      totalAnomalias({
        codigos_duplicados: ['a'],
        filhos_orfaos: ['b', 'c'],
        familias_sem_filho: [],
      })
    ).toBe(3);
  });

  it('lote limpo → 0', () => {
    expect(totalAnomalias(parseAnomalias({}))).toBe(0);
  });
});
