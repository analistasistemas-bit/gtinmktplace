import { describe, expect, it } from 'vitest';
import { calcularAlvo, centavos, maxDuasCasas, reais, semAlteracao } from '../alvo.ts';

describe('centavos — half-up decimal exato sobre String(v)', () => {
  it('10.075 → 1008', () => expect(centavos(10.075)).toBe(1008));
  it('1.005 → 101', () => expect(centavos(1.005)).toBe(101));
  it('2.675 → 268', () => expect(centavos(2.675)).toBe(268));
  it('19.999 → 2000', () => expect(centavos(19.999)).toBe(2000));
  it('10.0049999 → 1000', () => expect(centavos(10.0049999)).toBe(1000));
  it('inteiros e 1–2 casas', () => {
    expect(centavos(0)).toBe(0);
    expect(centavos(33)).toBe(3300);
    expect(centavos(49.9)).toBe(4990);
    expect(centavos(0.1)).toBe(10);
  });
  it('com sinal (simétrico)', () => {
    expect(centavos(-1.005)).toBe(-101);
    expect(centavos(-0.5)).toBe(-50);
  });
  it('notação exponencial / não finito → lança', () => {
    expect(() => centavos(1e-7)).toThrow();
    expect(() => centavos(1e21)).toThrow();
    expect(() => centavos(NaN)).toThrow();
    expect(() => centavos(Infinity)).toThrow();
  });
});

describe('maxDuasCasas', () => {
  it('até 2 casas → true', () => {
    for (const v of [0, 10, 10.5, 10.55, -3.2]) expect(maxDuasCasas(v)).toBe(true);
  });
  it('3+ casas, exponencial ou não finito → false', () => {
    for (const v of [10.555, 1.005, 1e-7, NaN, Infinity]) expect(maxDuasCasas(v)).toBe(false);
  });
});

describe('reais', () => {
  it('c / 100', () => expect(reais(2199)).toBe(21.99));
});

describe('calcularAlvo', () => {
  it('100,00 +1% → 101,00', () => expect(calcularAlvo(100, { tipo: 'pct', sentido: '+', valor: 1 })).toBe(101));
  it('19,99 +10% → 21,99', () => expect(calcularAlvo(19.99, { tipo: 'pct', sentido: '+', valor: 10 })).toBe(21.99));
  it('10,05 −5% → 9,55', () => expect(calcularAlvo(10.05, { tipo: 'pct', sentido: '-', valor: 5 })).toBe(9.55));
  it('0,50 −R$1 → null', () => expect(calcularAlvo(0.5, { tipo: 'reais', sentido: '-', valor: 1 })).toBeNull());
  it('alvo exatamente 0 → null', () => {
    expect(calcularAlvo(1, { tipo: 'reais', sentido: '-', valor: 1 })).toBeNull();
    expect(calcularAlvo(10, { tipo: 'pct', sentido: '-', valor: 100 })).toBeNull();
  });
  it('33,33 +0% → 33,33 e semAlteracao', () => {
    const alvo = calcularAlvo(33.33, { tipo: 'pct', sentido: '+', valor: 0 });
    expect(alvo).toBe(33.33);
    expect(semAlteracao(33.33, alvo!)).toBe(true);
  });
  it('49,90 +R$0,10 → 50,00', () => expect(calcularAlvo(49.9, { tipo: 'reais', sentido: '+', valor: 0.1 })).toBe(50));
  it('base 10,075 entra como 1008 centavos', () => {
    expect(calcularAlvo(10.075, { tipo: 'reais', sentido: '+', valor: 0 })).toBe(10.08);
  });
  it('pct com 2 casas (pontos-base): 100 +12,34% → 112,34', () => {
    expect(calcularAlvo(100, { tipo: 'pct', sentido: '+', valor: 12.34 })).toBe(112.34);
  });
  it('pct half-up exato no meio-centavo: 0,10 +5% = 0,105 → 0,11', () => {
    expect(calcularAlvo(0.1, { tipo: 'pct', sentido: '+', valor: 5 })).toBe(0.11);
  });
});

describe('semAlteracao', () => {
  it('compara em centavos', () => {
    expect(semAlteracao(10, 10.001)).toBe(true);
    expect(semAlteracao(10, 10.01)).toBe(false);
  });
});
