import { describe, expect, it } from 'vitest';
import { deslocamentoHorizontal } from '../utils';

describe('deslocamentoHorizontal', () => {
  const lista = { left: 16, right: 374 };
  it('item visível não rola', () => {
    expect(deslocamentoHorizontal(lista, { left: 100, right: 200 })).toBe(0);
  });
  it('item além da direita rola o que falta', () => {
    expect(deslocamentoHorizontal(lista, { left: 358, right: 442 })).toBe(68);
  });
  it('item antes da esquerda rola de volta', () => {
    expect(deslocamentoHorizontal(lista, { left: -30, right: 40 })).toBe(-46);
  });
});
