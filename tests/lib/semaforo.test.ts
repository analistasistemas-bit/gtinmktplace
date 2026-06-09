import { describe, it, expect } from 'vitest';
import { calcularSemaforo, freteSobConta } from '@/lib/semaforo';

describe('calcularSemaforo', () => {
  it('líquido ≥ piso → verde', () => {
    expect(calcularSemaforo(21, 20, 10)).toBe('verde');
    expect(calcularSemaforo(20, 20, 10)).toBe('verde');
  });
  it('custo ≤ líquido < piso → amarelo', () => {
    expect(calcularSemaforo(15, 20, 10)).toBe('amarelo');
  });
  it('líquido < custo → vermelho', () => {
    expect(calcularSemaforo(8, 20, 10)).toBe('vermelho');
  });
  it('sem custo: abaixo do piso vira amarelo (não dá pra saber prejuízo)', () => {
    expect(calcularSemaforo(8, 20, null)).toBe('amarelo');
  });
  it('líquido null → indisponível', () => {
    expect(calcularSemaforo(null, 20, 10)).toBe('indisponivel');
  });
});

describe('freteSobConta', () => {
  it('acima de R$ 19 → true', () => { expect(freteSobConta(19.05)).toBe(true); });
  it('19 ou menos → false', () => { expect(freteSobConta(19)).toBe(false); });
});
