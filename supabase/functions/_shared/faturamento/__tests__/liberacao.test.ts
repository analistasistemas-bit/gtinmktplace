import { describe, it, expect } from 'vitest';
import { liquidoDasLiberadas, type VendaLiberacao } from '../liberacao';

// Pack real 2000014948061807: 2 orders de 66,40, comissão 7,67, frete do envio 18,30 gravado
// INTEIRO em cada order, cupom do vendedor 2,50 → liquido gravado 37,93 em cada uma.
const order = (id: string, over: Partial<VendaLiberacao> = {}): VendaLiberacao => ({
  id, status: 'paid', shipping_id: 47973149558, pack_id: 2000014948061807, frete_vendedor: 18.3,
  sale_fee_total: 7.67, total_amount: 66.4, cupom_vendedor: 2.5, liquido: 37.93, ...over,
});
const soma = (m: Map<string, number>) => Math.round([...m.values()].reduce((s, x) => s + x, 0) * 100) / 100;

describe('liquidoDasLiberadas', () => {
  it('pack liberado no mesmo dia: frete conta uma vez (94,16, não 75,86)', () => {
    const a = order('a'); const b = order('b');
    expect(soma(liquidoDasLiberadas([a, b], [a, b]))).toBe(94.16);
  });

  it('só uma order do pack libera hoje: recebe só a sua fatia do frete', () => {
    const a = order('a'); const b = order('b');
    const m = liquidoDasLiberadas([a], [a, b]);
    expect([...m.keys()]).toEqual(['a']);
    expect(m.get('a')).toBe(47.08); // 66,40 − 2,50 − 7,67 − 9,15
  });

  it('venda avulsa usa o liquido gravado', () => {
    const v = order('v', { shipping_id: 1, pack_id: null, liquido: 40 });
    expect(liquidoDasLiberadas([v], [v]).get('v')).toBe(40);
  });

  it('membro cancelado do envio não absorve frete', () => {
    const a = order('a'); const c = order('c', { status: 'cancelled' });
    expect(liquidoDasLiberadas([a], [a, c]).get('a')).toBe(37.93);
  });
});
