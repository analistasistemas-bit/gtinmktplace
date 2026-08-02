import { describe, expect, it } from 'vitest';
import { parseNumeroPtBr } from '../formato';

describe('parseNumeroPtBr', () => {
  it.each([
    ['1.234', 1234],
    ['1.234,56', 1234.56],
    ['1234,56', 1234.56],
    ['12,5', 12.5],
    ['12.5', 12.5],
    ['0.5', 0.5],
    ['1.000', 1000],
    ['1.234.567', 1234567],
    ['1.234.567,89', 1234567.89],
    ['-5', -5],
  ])('parseNumeroPtBr(%s) === %s', (input, esperado) => {
    expect(parseNumeroPtBr(input)).toBe(esperado);
  });

  it('campo vazio (ou só espaços) é null, não NaN', () => {
    expect(parseNumeroPtBr('')).toBeNull();
    expect(parseNumeroPtBr('   ')).toBeNull();
  });

  it('texto não numérico é NaN, nunca vira vazio em silêncio', () => {
    expect(parseNumeroPtBr('abc')).toBeNaN();
  });
});
