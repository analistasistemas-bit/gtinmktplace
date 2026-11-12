import { describe, expect, it } from 'vitest';
import { itemParaVerAnuncio } from '../produtos-saldo';

describe('itemParaVerAnuncio', () => {
  it('kit com variação: padrão zerado cai no primeiro item com saldo', () => {
    const v = [
      { estoque: 0, mlItemId: 'MLB1' }, { estoque: 0, mlItemId: 'MLB2' },
      { estoque: 2, mlItemId: 'MLB7' }, { estoque: 2, mlItemId: 'MLB8' },
    ];
    expect(itemParaVerAnuncio('MLB1', v)).toBe('MLB7');
  });
  it('mantém o padrão quando ele tem saldo', () => {
    expect(itemParaVerAnuncio('MLB8', [{ estoque: 2, mlItemId: 'MLB7' }, { estoque: 1, mlItemId: 'MLB8' }])).toBe('MLB8');
  });
  it('sem variações lidas, tudo zerado ou sem item: devolve o padrão', () => {
    expect(itemParaVerAnuncio('MLB1', undefined)).toBe('MLB1');
    expect(itemParaVerAnuncio('MLB1', [{ estoque: 0, mlItemId: 'MLB2' }])).toBe('MLB1');
    expect(itemParaVerAnuncio('MLB1', [{ estoque: 3, mlItemId: null }])).toBe('MLB1');
    expect(itemParaVerAnuncio(null, undefined)).toBeNull();
  });
});
