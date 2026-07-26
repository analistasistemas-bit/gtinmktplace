import { describe, it, expect } from 'vitest';
import { extrairGtin } from '../pedidos';

describe('extrairGtin', () => {
  it('pega o value_name do atributo GTIN', () => {
    expect(extrairGtin({ id: 'MLB1', attributes: [
      { id: 'BRAND', value_name: 'Progresso' },
      { id: 'GTIN', value_name: '7909857046700' },
    ] })).toBe('7909857046700');
  });

  it('retorna null sem GTIN', () => {
    expect(extrairGtin({ id: 'MLB1', attributes: [{ id: 'BRAND', value_name: 'X' }] })).toBeNull();
    expect(extrairGtin(null)).toBeNull();
    expect(extrairGtin({ id: 'MLB1' })).toBeNull();
  });
});
