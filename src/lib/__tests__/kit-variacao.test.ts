import { describe, it, expect } from 'vitest';
import { gerarCombinacoes, maximoPorCelula, normalizarCombinacao, rotuloCombinacao } from '../kit-variacao';

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

describe('maximoPorCelula', () => {
  const p = (cor: string, tamanho: string, estoque: number, excluidaDaPublicacao = false) => ({ cor, tamanho, estoque, excluidaDaPublicacao });
  const base = [p('Preto', 'M', 2), p('Branco', 'M', 5), p('Marrom', 'M', 4), p('Preto', 'G', 9), p('Branco', 'G', 9), p('Bege', 'M', 0)];

  it('é o menor estoque entre as cores da combinação naquele tamanho', () => {
    expect(maximoPorCelula(base, { cores: ['Preto', 'Branco'], tamanho: 'M' }, [])).toEqual({ maximo: 2, faltam: [] });
    expect(maximoPorCelula(base, { cores: ['Branco', 'Marrom'], tamanho: 'M' }, [])).toEqual({ maximo: 4, faltam: [] });
  });

  it('diminui com o que as outras células do mesmo tamanho já usam; a própria célula e outro tamanho não contam', () => {
    const qtd = [
      { cores: ['Preto', 'Marrom'], tamanho: 'M', quantidade: 1 },
      { cores: ['Branco', 'Preto'], tamanho: 'M', quantidade: 2 },   // a própria célula, em outra ordem
      { cores: ['Preto', 'Branco'], tamanho: 'G', quantidade: 5 },
    ];
    expect(maximoPorCelula(base, { cores: ['Preto', 'Branco'], tamanho: 'M' }, qtd)).toEqual({ maximo: 1, faltam: [] });
  });

  it('cor sem peça (zerada, esgotada ou inexistente no tamanho) zera o máximo e é apontada', () => {
    expect(maximoPorCelula(base, { cores: ['Preto', 'Bege'], tamanho: 'M' }, [])).toEqual({ maximo: 0, faltam: ['Bege'] });
    expect(maximoPorCelula(base, { cores: ['Marrom', 'Preto'], tamanho: 'G' }, [])).toEqual({ maximo: 0, faltam: ['Marrom'] });
    const esgota = [{ cores: ['Preto', 'Marrom'], tamanho: 'M', quantidade: 2 }];
    expect(maximoPorCelula(base, { cores: ['Preto', 'Branco'], tamanho: 'M' }, esgota)).toEqual({ maximo: 0, faltam: ['Preto'] });
  });

  it('ignora variação excluída da publicação', () => {
    const comExcluida = [p('Marrom', 'G', 50, true), ...base];
    expect(maximoPorCelula(comExcluida, { cores: ['Branco', 'Marrom'], tamanho: 'G' }, [])).toEqual({ maximo: 0, faltam: ['Marrom'] });
  });
});
