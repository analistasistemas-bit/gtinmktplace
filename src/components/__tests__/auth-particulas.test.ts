import { describe, it, expect } from 'vitest';
import { anguloAlvo } from '../auth-particulas';

const RAIO = 100;

describe('anguloAlvo', () => {
  it('mantém o ângulo base quando o cursor está fora do raio', () => {
    expect(anguloAlvo(0.7, 0, 0, 300, 0, RAIO)).toBe(0.7);
  });

  it('mantém o ângulo base quando o cursor está exatamente sobre a partícula', () => {
    expect(anguloAlvo(0.7, 10, 10, 10, 10, RAIO)).toBe(0.7);
  });

  it('aponta para o cursor quando ele está colado na partícula', () => {
    // cursor à direita, a 1px: peso ≈ 1 → ângulo ≈ 0 (horizontal)
    expect(anguloAlvo(1.2, 0, 0, 1, 0, RAIO)).toBeCloseTo(0, 1);
  });

  it('interpola pela metade na metade do raio', () => {
    // base 0, cursor na vertical a 50px de um raio 100 → alvo π/2, peso 0.5
    expect(anguloAlvo(0, 0, 0, 0, 50, RAIO)).toBeCloseTo(Math.PI / 4, 5);
  });

  it('gira no máximo 90° — o traço é simétrico, não precisa dar meia-volta', () => {
    // base ≈ π/2 (vertical), cursor na horizontal a 1px: girar +π/2 ou -π/2 dá o mesmo
    // traço; a rotação escolhida nunca deve passar de π/2 em módulo.
    for (const base of [0.1, 1.0, 2.0, 3.0]) {
      const delta = anguloAlvo(base, 0, 0, 1, 0, RAIO) - base;
      expect(Math.abs(delta)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
  });
});
