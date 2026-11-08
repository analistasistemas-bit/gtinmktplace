import { describe, expect, it } from 'vitest';
import { corExibida, palavrasForaDoTitulo, titulosRepetidos } from '../conferencia-titulo';
import type { Familia } from '../tipos-dominio';

const familia = (id: string, titulo: string, extra: Partial<Familia> = {}) =>
  ({ id, titulo, operacao: 'CREATE', status: 'pronto', ...extra }) as Familia;

describe('palavrasForaDoTitulo', () => {
  it('acha o nome comercial que sumiu', () => {
    expect(palavrasForaDoTitulo('Creme 2 em 1 BRILHO UVA 1kg', 'Creme 2 em 1 1kg')).toEqual(['brilho', 'uva']);
  });

  it('ignora acento, caixa, conector e medida', () => {
    expect(palavrasForaDoTitulo('NUTRIÇÃO para o Cabelo 1kg 125g', 'Nutricao Cabelo')).toEqual([]);
  });

  it('título completo não acusa nada', () => {
    expect(palavrasForaDoTitulo('Máscara Hidrata Muito Mais', 'Máscara Capilar Hidrata Muito Mais')).toEqual([]);
  });

  it('sem nome não acusa', () => {
    expect(palavrasForaDoTitulo(undefined, 'Creme')).toEqual([]);
  });

  it('não repete palavra', () => {
    expect(palavrasForaDoTitulo('Uva Uva', 'Creme')).toEqual(['uva']);
  });
});

describe('titulosRepetidos', () => {
  it('pega título igual, sem olhar acento ou caixa', () => {
    expect(titulosRepetidos([familia('a', 'Creme 1kg'), familia('b', 'CREME 1KG '), familia('c', 'Outro')]))
      .toEqual(new Set(['a', 'b']));
  });

  it('ignora reposição e publicada', () => {
    expect(titulosRepetidos([
      familia('a', 'Creme 1kg'),
      familia('b', 'Creme 1kg', { operacao: 'UPDATE' }),
      familia('c', 'Creme 1kg', { status: 'publicado' }),
    ])).toEqual(new Set());
  });
});

describe('corExibida', () => {
  it('esconde Outra só quando a cor não é exigida', () => {
    expect(corExibida('Outra', false)).toBe('');
    expect(corExibida('Outra', true)).toBe('Outra');
    expect(corExibida('Azul', false)).toBe('Azul');
  });
});
