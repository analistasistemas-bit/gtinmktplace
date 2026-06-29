import { describe, it, expect } from 'vitest';
import { caparEstoque } from '../capar-estoque';

describe('caparEstoque', () => {
  it('não altera quando a soma cabe no limite (no-op)', () => {
    const r = caparEstoque([{ sku: 'a', estoque: 100 }, { sku: 'b', estoque: 200 }], 99999);
    expect(r.get('a')).toBe(100);
    expect(r.get('b')).toBe(200);
  });

  it('capa por teto quando a soma estoura, cores iguais → teto igual', () => {
    const r = caparEstoque([{ sku: 'a', estoque: 60000 }, { sku: 'b', estoque: 60000 }], 99999);
    const soma = r.get('a')! + r.get('b')!;
    expect(soma).toBeLessThanOrEqual(99999);
    expect(r.get('a')).toBe(r.get('b'));
    expect(soma).toBeGreaterThanOrEqual(99998); // usa quase todo o espaço
  });

  it('preserva cores de baixo estoque e capa só as grandes', () => {
    const r = caparEstoque(
      [{ sku: 'a', estoque: 90000 }, { sku: 'b', estoque: 5000 }, { sku: 'c', estoque: 5000 }],
      99999,
    );
    expect(r.get('b')).toBe(5000);
    expect(r.get('c')).toBe(5000);
    expect(r.get('a')).toBe(89999);
    const soma = r.get('a')! + r.get('b')! + r.get('c')!;
    expect(soma).toBeLessThanOrEqual(99999);
  });

  it('uma cor gigante sozinha cai no limite', () => {
    const r = caparEstoque([{ sku: 'a', estoque: 200000 }], 99999);
    expect(r.get('a')).toBe(99999);
  });

  it('100 cores de estoque alto cabem no teto (caso 02835002)', () => {
    const itens = Array.from({ length: 100 }, (_, i) => ({ sku: `s${i}`, estoque: 1732 }));
    const r = caparEstoque(itens, 99999);
    const soma = [...r.values()].reduce((s, v) => s + v, 0);
    expect(soma).toBeLessThanOrEqual(99999);
    expect(soma).toBeGreaterThan(99000); // aproveita o espaço
  });
});
