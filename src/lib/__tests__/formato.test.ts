import { describe, it, expect } from 'vitest';
import { fmtMarkup } from '../formato';

describe('fmtMarkup', () => {
  it('formata markup positivo com sinal', () => {
    expect(fmtMarkup(0.42)).toBe('+42%');
  });

  it('formata markup negativo com sinal', () => {
    expect(fmtMarkup(-0.05)).toBe('-5%');
  });

  it('formata zero com sinal positivo', () => {
    expect(fmtMarkup(0)).toBe('+0%');
  });

  it('retorna "—" para null', () => {
    expect(fmtMarkup(null)).toBe('—');
  });

  it('retorna "—" para undefined', () => {
    expect(fmtMarkup(undefined)).toBe('—');
  });

  it('arredonda para o inteiro mais próximo', () => {
    expect(fmtMarkup(1.204)).toBe('+120%');
    expect(fmtMarkup(1.206)).toBe('+121%');
  });
});
