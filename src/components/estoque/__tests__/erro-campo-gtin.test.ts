import { describe, it, expect } from 'vitest';
import { erroCampo } from '@/components/estoque/linha-variacao-form';

describe('erroCampo gtin', () => {
  it('avisa EAN inválido (quantidade digitada na aba GTIN)', () => {
    expect(erroCampo('gtin', '2')).toMatch(/EAN inválido/);
  });
  it('vazio, 3000* e EAN válido não avisam', () => {
    expect(erroCampo('gtin', '')).toBeNull();
    expect(erroCampo('gtin', '3000008412400')).toBeNull();
    expect(erroCampo('gtin', '7891234567895')).toBeNull();
  });
});
