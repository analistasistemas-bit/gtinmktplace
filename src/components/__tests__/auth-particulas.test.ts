import { describe, it, expect } from 'vitest';
import { orientar } from '../auth-particulas';

const RAIO = 100;

describe('orientar', () => {
  it('fica em repouso quando o cursor está fora do raio', () => {
    expect(orientar(0.7, 0, 0, 300, 0, RAIO)).toEqual({ ang: 0.7, peso: 0 });
  });

  it('fica em repouso quando o cursor está exatamente sobre a partícula', () => {
    expect(orientar(0.7, 10, 10, 10, 10, RAIO)).toEqual({ ang: 0.7, peso: 0 });
  });

  it('aponta para o cursor com peso máximo quando ele está colado', () => {
    // cursor à direita, a 1px: peso ≈ 1 → ângulo ≈ 0 (horizontal)
    const r = orientar(1.2, 0, 0, 1, 0, RAIO);
    expect(r.ang).toBeCloseTo(0, 1);
    expect(r.peso).toBeCloseTo(1, 1);
  });

  it('interpola pela metade na metade do raio', () => {
    // base 0, cursor na vertical a 50px de um raio 100 → alvo π/2, peso 0.5
    const r = orientar(0, 0, 0, 0, 50, RAIO);
    expect(r.peso).toBeCloseTo(0.5, 5);
    expect(r.ang).toBeCloseTo(Math.PI / 4, 5);
  });

  it('o peso cai linearmente com a distância', () => {
    expect(orientar(0, 0, 0, 25, 0, RAIO).peso).toBeCloseTo(0.75, 5);
    expect(orientar(0, 0, 0, 90, 0, RAIO).peso).toBeCloseTo(0.1, 5);
  });

  it('gira no máximo 90° — o traço é simétrico, não precisa dar meia-volta', () => {
    // girar +π/2 ou -π/2 desenha o mesmo traço; a rotação escolhida é sempre a menor.
    for (const base of [0.1, 1.0, 2.0, 3.0]) {
      const delta = orientar(base, 0, 0, 1, 0, RAIO).ang - base;
      expect(Math.abs(delta)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9);
    }
  });
});
