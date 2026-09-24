import { describe, it, expect } from 'vitest';
import { rotuloVariacao, ordenarVariacoesGrade } from '@/lib/rotulo-variacao';

describe('rotuloVariacao', () => {
  it('sem tamanho = cor ?? nome (INV-1, igual ao de hoje)', () => {
    expect(rotuloVariacao({ cor: 'Preto', nome: 'Preto X' })).toBe('Preto');
    expect(rotuloVariacao({ cor: null, nome: 'Fita' })).toBe('Fita');
    expect(rotuloVariacao({ cor: null, nome: null })).toBeNull();
    expect(rotuloVariacao({ cor: 'Preto', nome: null, tamanho: null })).toBe('Preto');
    expect(rotuloVariacao({ cor: 'Preto', nome: null, tamanho: '  ' })).toBe('Preto');
  });
  it('com tamanho = "cor · tamanho"', () => {
    expect(rotuloVariacao({ cor: 'Preto', nome: 'Preto', tamanho: 'M' })).toBe('Preto · M');
    expect(rotuloVariacao({ cor: null, nome: null, tamanho: '42' })).toBe('42');
  });
});

describe('ordenarVariacoesGrade', () => {
  it('ordena por cor e, dentro da cor, na ordem canônica do tamanho', () => {
    const vs = [
      { codigo: '3', cor: 'Preto', nome: 'Preto', tamanho: 'G' },
      { codigo: '1', cor: 'Azul', nome: 'Azul', tamanho: 'P' },
      { codigo: '2', cor: 'Preto', nome: 'Preto', tamanho: 'P' },
      { codigo: '4', cor: 'Preto', nome: 'Preto', tamanho: 'M' },
    ];
    expect(ordenarVariacoesGrade(vs).map((v) => v.codigo)).toEqual(['1', '2', '4', '3']);
  });
  it('sem tamanho em nenhuma variação devolve a lista na MESMA ordem (INV-1)', () => {
    const vs = [{ cor: 'Z', nome: 'Z' }, { cor: 'A', nome: 'A' }];
    expect(ordenarVariacoesGrade(vs)).toEqual(vs);
  });
  it('numeração de calçado em ordem numérica canônica', () => {
    const vs = [{ cor: 'Preto', nome: null, tamanho: '40' }, { cor: 'Preto', nome: null, tamanho: '38' }];
    expect(ordenarVariacoesGrade(vs).map((v) => v.tamanho)).toEqual(['38', '40']);
  });
});
