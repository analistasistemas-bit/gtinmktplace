import { describe, it, expect } from 'vitest';
import { calcularSemaforo } from '@/lib/semaforo';

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
  it('líquido < custo com piso abaixo do custo → vermelho (nunca verde no prejuízo)', () => {
    expect(calcularSemaforo(35, 30, 59.8)).toBe('vermelho');
  });
  it('sem custo: abaixo do piso vira amarelo (não dá pra saber prejuízo)', () => {
    expect(calcularSemaforo(8, 20, null)).toBe('amarelo');
  });
  it('líquido null → indisponível', () => {
    expect(calcularSemaforo(null, 20, 10)).toBe('indisponivel');
  });
});
