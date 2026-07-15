import { describe, it, expect } from 'vitest';
import { resolverSomenteEstoque } from '../somente-estoque';

describe('resolverSomenteEstoque', () => {
  it('override inverte o global por família', () => {
    // global só-estoque, F1 no override = atualizar tudo
    expect(resolverSomenteEstoque('F1', true, ['F1'])).toBe(false);
    expect(resolverSomenteEstoque('F2', true, ['F1'])).toBe(true);
    // global tudo, F3 no override = só estoque
    expect(resolverSomenteEstoque('F3', false, ['F3'])).toBe(true);
    expect(resolverSomenteEstoque('F4', false, ['F3'])).toBe(false);
  });

  it('sem overrides devolve o global (default [])', () => {
    expect(resolverSomenteEstoque('F1', false)).toBe(false);
    expect(resolverSomenteEstoque('F1', true)).toBe(true);
  });
});
