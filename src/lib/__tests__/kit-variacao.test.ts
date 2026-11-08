import { describe, it, expect } from 'vitest';
import { gerarCombinacoes, normalizarCombinacao, rotuloCombinacao } from '../kit-variacao';

describe('gerarCombinacoes', () => {
  it('5 cores em kits de 4 dão 5 combinações, sem repetição', () => {
    const c = gerarCombinacoes(['P', 'B', 'M', 'A', 'V'], 4);
    expect(c).toHaveLength(5);
    expect(new Set(c.map((x) => x.join('|'))).size).toBe(5);
    expect(c.every((x) => new Set(x).size === 4)).toBe(true);
    expect(c[0]).toEqual(['P', 'B', 'M', 'A']);
  });

  it('peças acima das cores não gera nada', () => {
    expect(gerarCombinacoes(['P', 'B'], 3)).toEqual([]);
    expect(gerarCombinacoes(['P', 'B', 'M'], 2)).toEqual([['P', 'B'], ['P', 'M'], ['B', 'M']]);
  });
});

describe('rotuloCombinacao', () => {
  it('junta com vírgula e "e"', () => {
    expect(rotuloCombinacao(['Preto', 'Branco', 'Marrom'])).toBe('Preto, Branco e Marrom');
    expect(rotuloCombinacao(['Preto', 'Branco'])).toBe('Preto e Branco');
  });
});

describe('normalizarCombinacao', () => {
  it('ordem das cores marcadas; repetida ou fora da seleção é inválida', () => {
    expect(normalizarCombinacao(['P', 'B', 'M'], ['M', 'P'])).toEqual(['P', 'M']);
    expect(normalizarCombinacao(['P', 'B', 'M'], ['P', 'P'])).toBeNull();
    expect(normalizarCombinacao(['P', 'B'], ['P', 'X'])).toBeNull();
  });
});
