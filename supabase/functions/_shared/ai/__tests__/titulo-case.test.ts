import { describe, it, expect } from 'vitest';
import { tituloCase } from '../titulo-case';

describe('tituloCase', () => {
  it('capitaliza palavras comuns', () => {
    expect(tituloCase('FITA CETIM', true)).toBe('Fita Cetim');
  });

  it('mantém preposição e artigo em minúscula, exceto na primeira palavra', () => {
    expect(tituloCase('AGULHA DE CROCHE', true)).toBe('Agulha de Croche');
    expect(tituloCase('SACO DE ORGANZA', true)).toBe('Saco de Organza');
    expect(tituloCase('PARA FORRO', false)).toBe('para Forro');
  });

  it('primeira palavra do primeiro slot capitaliza mesmo sendo preposição', () => {
    expect(tituloCase('DE LUXO', true)).toBe('De Luxo');
  });

  it('mantém unidade em minúscula', () => {
    expect(tituloCase('100M', false)).toBe('100m');
    expect(tituloCase('6MM', false)).toBe('6mm');
    expect(tituloCase('500G', false)).toBe('500g');
    expect(tituloCase('10UN', false)).toBe('10un');
    expect(tituloCase('3,5CM', false)).toBe('3,5cm');
  });

  it('mantém sigla da lista fechada em caixa alta', () => {
    expect(tituloCase('PVC', false)).toBe('PVC');
    expect(tituloCase('EVA', false)).toBe('EVA');
    expect(tituloCase('FPS 60', false)).toBe('FPS 60');
  });

  it('formata percentual seguido de material', () => {
    expect(tituloCase('100% POLIESTER', false)).toBe('100% Poliester');
    expect(tituloCase('85% ALGODAO', false)).toBe('85% Algodao');
  });

  it('Tex não é sigla — vira Title Case', () => {
    expect(tituloCase('TEX 29', false)).toBe('Tex 29');
  });

  it('preserva a forma da numeração da fonte', () => {
    expect(tituloCase('N.3', false)).toBe('N.3');
    expect(tituloCase('N.02', false)).toBe('N.02');
    expect(tituloCase('4/6', false)).toBe('4/6');
  });
});
