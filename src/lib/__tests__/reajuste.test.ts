import { describe, expect, it } from 'vitest';
import * as back from '../../../supabase/functions/_shared/operacoes/reajuste/alvo.ts';
import { calcularAlvo, centavos, formatarAjuste, reais, semAlteracao } from '../reajuste';
import type { Ajuste } from '../reajuste';

const pct = (sentido: '+' | '-', valor: number): Ajuste => ({ tipo: 'pct', sentido, valor });
const rs = (sentido: '+' | '-', valor: number): Ajuste => ({ tipo: 'reais', sentido, valor });

// Paridade front × backend (C4): o front re-exporta a mesma função; os 20 casos fixam o contrato.
const CASOS: [number, Ajuste, number | null][] = [
  [100, pct('+', 1), 101], [19.99, pct('+', 10), 21.99], [10.05, pct('-', 5), 9.55], [0.5, rs('-', 1), null],
  [1, rs('-', 1), null], [10, pct('-', 100), null], [33.33, pct('+', 0), 33.33], [49.9, rs('+', 0.1), 50],
  [10.075, rs('+', 0), 10.08], [100, pct('+', 12.34), 112.34], [0.1, pct('+', 5), 0.11], [59.9, pct('-', 10), 53.91],
  [129.9, pct('+', 7.5), 139.64], [79.99, rs('-', 5), 74.99], [15, rs('+', 2.5), 17.5], [1.01, pct('-', 50), 0.51],
  [999.99, pct('+', 0.01), 1000.09], [24.9, pct('-', 15), 21.17], [0.01, pct('-', 50), 0.01], [10, pct('-', 150), null],
];

describe('calcularAlvo — paridade com o backend', () => {
  it('é a mesma função (re-export, não cópia)', () => {
    expect(calcularAlvo).toBe(back.calcularAlvo);
    expect(semAlteracao).toBe(back.semAlteracao);
    expect(centavos).toBe(back.centavos);
    expect(reais).toBe(back.reais);
  });
  it.each(CASOS)('%s %o → %s', (base, a, esperado) => {
    expect(calcularAlvo(base, a)).toBe(esperado);
    expect(back.calcularAlvo(base, a)).toBe(esperado);
  });
});

describe('formatarAjuste', () => {
  it('pct e reais, com sinal', () => {
    expect(formatarAjuste(pct('+', 10))).toBe('+10%');
    expect(formatarAjuste(pct('-', 2.5))).toBe('−2,5%');
    expect(formatarAjuste(rs('+', 5))).toBe('+R$ 5,00');
    expect(formatarAjuste(rs('-', 0.1))).toBe('−R$ 0,10');
  });
});
