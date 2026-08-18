import { describe, expect, it } from 'vitest';
import { fmtMilhar, parseNumeroPtBr } from '../formato';

describe('fmtMilhar', () => {
  it('sem decimal (comportamento das telas que já usavam) arredonda o milhar', () => {
    expect(fmtMilhar(154_100)).toBe('154 mil');
    expect(fmtMilhar(10_000)).toBe('10 mil');
    expect(fmtMilhar(60)).toBe('60');
  });
  it('milhões sempre com 1 casa, independente do parâmetro', () => {
    expect(fmtMilhar(17_470_820)).toBe('17,5 mi');
    expect(fmtMilhar(17_470_820, 1)).toBe('17,5 mi');
  });
  it('decimaisMil=1 detalha o milhar mas omite o decimal zero', () => {
    expect(fmtMilhar(154_100, 1)).toBe('154,1 mil');
    expect(fmtMilhar(79_830, 1)).toBe('79,8 mil');
    expect(fmtMilhar(10_000, 1)).toBe('10 mil'); // não "10,0 mil"
  });
});

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
    // Limite superior do quantificador {3}: 4+ dígitos não casa como milhar, cai no
    // ramo "passa direto". Guarda contra um refactor futuro trocar {3} por {3,}.
    ['1.2345', 1.2345],
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

  it('milhar malformado (grupos incompletos) é NaN, não um número lixo', () => {
    expect(parseNumeroPtBr('1.234.56')).toBeNaN();
  });
});
