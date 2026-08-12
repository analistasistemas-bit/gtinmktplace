import { describe, it, expect } from 'vitest';
import { gtinInvalido, normGtin } from '../gtin';

describe('normGtin', () => {
  it('remove zeros à esquerda para casar ML × planilha', () => {
    expect(normGtin('0007891234567895')).toBe('7891234567895');
  });
});

describe('gtinInvalido', () => {
  it('vazio/nulo não é inválido — é ausência (publica como "sem código")', () => {
    expect(gtinInvalido(null)).toBe(false);
    expect(gtinInvalido('')).toBe(false);
    expect(gtinInvalido('   ')).toBe(false);
  });
  it('código interno 3000* não é inválido — é ausência conhecida', () => {
    expect(gtinInvalido('30001234')).toBe(false);
  });
  it('EAN-13 e EAN-8 com dígito verificador correto são válidos', () => {
    expect(gtinInvalido('7891234567895')).toBe(false);
    expect(gtinInvalido('96385074')).toBe(false);
  });
  it('dígito verificador errado é inválido (lote #46, importado)', () => {
    expect(gtinInvalido('48251671')).toBe(true);
    expect(gtinInvalido('7891234567890')).toBe(true);
  });
  it('comprimento fora de 8/12/13/14 é inválido', () => {
    expect(gtinInvalido('123')).toBe(true);
    expect(gtinInvalido('533100017')).toBe(true);
  });
  it('caracteres não numéricos são inválidos', () => {
    expect(gtinInvalido('789ABC1234567')).toBe(true);
  });
});
