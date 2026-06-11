import { describe, it, expect } from 'vitest';
import { rotuloQuantidade } from '../unidade';

describe('rotuloQuantidade', () => {
  it('unidade de peso (KG) → "Peso"', () => {
    expect(rotuloQuantidade('KG')).toBe('Peso');
  });

  it('normaliza caixa e espaços (" kg " → "Peso")', () => {
    expect(rotuloQuantidade(' kg ')).toBe('Peso');
  });

  it('gramas (G / GRAMAS) → "Peso"', () => {
    expect(rotuloQuantidade('G')).toBe('Peso');
    expect(rotuloQuantidade('GRAMAS')).toBe('Peso');
  });

  it('volume (L / ML) → "Volume"', () => {
    expect(rotuloQuantidade('L')).toBe('Volume');
    expect(rotuloQuantidade('ML')).toBe('Volume');
  });

  it('comprimento (MT / METROS) → "Metragem"', () => {
    expect(rotuloQuantidade('MT')).toBe('Metragem');
    expect(rotuloQuantidade('METROS')).toBe('Metragem');
  });

  it('unidades de embalagem (PC/RL/UN/CN) → null (IA decide pelo dado da descrição)', () => {
    expect(rotuloQuantidade('PC')).toBeNull();
    expect(rotuloQuantidade('RL')).toBeNull();
    expect(rotuloQuantidade('UN')).toBeNull();
    expect(rotuloQuantidade('CN')).toBeNull();
  });

  it('vazio/nulo/desconhecido → null', () => {
    expect(rotuloQuantidade(null)).toBeNull();
    expect(rotuloQuantidade('')).toBeNull();
    expect(rotuloQuantidade('XYZ')).toBeNull();
  });
});
