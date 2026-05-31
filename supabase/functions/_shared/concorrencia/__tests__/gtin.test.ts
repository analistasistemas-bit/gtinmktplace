import { describe, it, expect } from 'vitest';
import { gtinValido } from '../gtin';

describe('gtinValido', () => {
  it('rejeita nulo e vazio', () => {
    expect(gtinValido(null)).toBe(false);
    expect(gtinValido('')).toBe(false);
    expect(gtinValido('   ')).toBe(false);
  });

  it('rejeita código interno 3000* (não é EAN real)', () => {
    expect(gtinValido('30001234')).toBe(false);
    expect(gtinValido('3000123456789')).toBe(false);
  });

  it('rejeita não-dígitos e comprimentos inválidos', () => {
    expect(gtinValido('abc')).toBe(false);
    expect(gtinValido('123')).toBe(false);          // curto demais
    expect(gtinValido('123456789012345')).toBe(false); // 15 dígitos
    expect(gtinValido('7891234abc012')).toBe(false);
  });

  it('aceita EAN/GTIN de comprimento válido (8,12,13,14)', () => {
    expect(gtinValido('78912345')).toBe(true);        // 8
    expect(gtinValido('789123456789')).toBe(true);    // 12
    expect(gtinValido('7891234567890')).toBe(true);   // 13
    expect(gtinValido('78912345678901')).toBe(true);  // 14
  });

  it('tolera espaços nas bordas', () => {
    expect(gtinValido(' 7891234567890 ')).toBe(true);
  });
});
