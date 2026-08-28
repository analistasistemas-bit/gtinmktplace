import { describe, it, expect } from 'vitest';
import {
  amostrarPoisson,
  distanciasPorDensidade,
  ruido1d,
} from '../auth-particulas/amostragem';

/** Gerador determinístico: sem isto o teste de distância mínima seria flaky. */
function randomSemente(semente: number): () => number {
  let s = semente >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('distanciasPorDensidade', () => {
  it('interpola min 10→2 e max 11→3 entre densidade 0 e 300', () => {
    expect(distanciasPorDensidade(0)).toEqual({ min: 10, max: 11 });
    expect(distanciasPorDensidade(300)).toEqual({ min: 2, max: 3 });
  });

  it('na densidade default (230) chega perto dos números do efeito original', () => {
    const { min, max } = distanciasPorDensidade(230);
    expect(min).toBeCloseTo(3.87, 2);
    expect(max).toBeCloseTo(4.87, 2);
  });

  it('trava fora da faixa em vez de extrapolar', () => {
    expect(distanciasPorDensidade(-50)).toEqual(distanciasPorDensidade(0));
    expect(distanciasPorDensidade(9000)).toEqual(distanciasPorDensidade(300));
  });
});

describe('amostrarPoisson', () => {
  const lado = 100;
  const distMin = 5;
  const pontos = amostrarPoisson(lado, distMin, 7, randomSemente(42));

  it('respeita a distância mínima entre todos os pares', () => {
    // É o contrato do Poisson-disk: sem isto o campo teria grumos e buracos.
    let menor = Infinity;
    for (let i = 0; i < pontos.length; i++) {
      for (let j = i + 1; j < pontos.length; j++) {
        const dx = pontos[i][0] - pontos[j][0];
        const dy = pontos[i][1] - pontos[j][1];
        menor = Math.min(menor, Math.hypot(dx, dy));
      }
    }
    expect(menor).toBeGreaterThanOrEqual(distMin);
  });

  it('mantém todos os pontos dentro da grade', () => {
    for (const [x, y] of pontos) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(lado);
      expect(y).toBeLessThan(lado);
    }
  });

  it('preenche a área — bem mais denso que um sorteio ralo', () => {
    // Empacotamento de Poisson-disk fica em torno de 0,7·área/distMin²; exijo metade disso
    // para o teste não quebrar com variação do gerador.
    expect(pontos.length).toBeGreaterThan((0.35 * lado * lado) / (distMin * distMin));
  });

  it('é determinístico com a mesma semente', () => {
    expect(amostrarPoisson(lado, distMin, 7, randomSemente(42))).toEqual(pontos);
  });
});

describe('ruido1d', () => {
  it('fica em [0,1)', () => {
    for (let t = 0; t < 50; t += 0.37) {
      expect(ruido1d(t)).toBeGreaterThanOrEqual(0);
      expect(ruido1d(t)).toBeLessThan(1);
    }
  });

  it('é contínuo — o anel não pode teleportar entre quadros', () => {
    for (let t = 0; t < 20; t += 0.5) {
      expect(Math.abs(ruido1d(t + 0.01) - ruido1d(t))).toBeLessThan(0.05);
    }
  });

  it('varia de verdade ao longo do tempo', () => {
    const amostras = Array.from({ length: 40 }, (_, i) => ruido1d(i * 0.7));
    expect(Math.max(...amostras) - Math.min(...amostras)).toBeGreaterThan(0.5);
  });
});
