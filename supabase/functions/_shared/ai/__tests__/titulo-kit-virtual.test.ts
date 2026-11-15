import { describe, expect, it } from 'vitest';
import { tituloKitValido } from '../titulo-kit-virtual.ts';

describe('tituloKitValido', () => {
  it('aceita título que começa com "Kit " e cabe no teto', () => {
    expect(tituloKitValido('Kit Shampoo + Máscara Tanox')).toBe(true);
    expect(tituloKitValido('kit shampoo')).toBe(true);
  });
  it('recusa título sem o prefixo "Kit "', () => {
    expect(tituloKitValido('Shampoo e Máscara')).toBe(false);
    expect(tituloKitValido('Kitchen Shampoo')).toBe(false);
  });
  it('recusa vazio e acima de 60 caracteres', () => {
    expect(tituloKitValido('   ')).toBe(false);
    expect(tituloKitValido(`Kit ${'a'.repeat(57)}`)).toBe(false); // 61
    expect(tituloKitValido(`Kit ${'a'.repeat(56)}`)).toBe(true); // 60
  });
});
