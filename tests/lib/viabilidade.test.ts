import { describe, it, expect } from 'vitest';
import { liquidoNoMercado, etiquetaParaMinimo, semaforoTipo } from '@/lib/viabilidade';

describe('liquidoNoMercado', () => {
  it('menor preço menos a comissão total, arredondado a 2 casas', () => {
    expect(liquidoNoMercado(25, 3.5)).toBeCloseTo(21.5, 2);
  });
  it('null quando não há menor preço', () => {
    expect(liquidoNoMercado(null, 3.5)).toBeNull();
  });
  it('subtrai também o imposto quando informado (ADR-0055)', () => {
    // 100 − 15 comissão − 8 imposto = 77
    expect(liquidoNoMercado(100, 15, 8)).toBeCloseTo(77, 2);
  });
});

describe('etiquetaParaMinimo (gross-up acima do abismo)', () => {
  it('mínimo R$ 20, 14% → 20/0,86 = 23,26 → arredonda cima 23,30', () => {
    expect(etiquetaParaMinimo(20, 14)).toBeCloseTo(23.3, 2);
  });
  it('mínimo baixo (R$ 4, 14%) → empurra para R$ 12,55 (acima do abismo)', () => {
    expect(etiquetaParaMinimo(4, 14)).toBeCloseTo(12.55, 2);
  });
  it('null quando não há mínimo', () => {
    expect(etiquetaParaMinimo(null, 14)).toBeNull();
  });
});

describe('semaforoTipo (igualar o mercado)', () => {
  it('líquido no mercado ≥ mínimo → verde', () => {
    expect(semaforoTipo(25, 3.5, 4, 1.5)).toBe('verde');
  });
  it('líquido entre custo e mínimo → amarelo', () => {
    expect(semaforoTipo(6, 3.84, 4, 1.5)).toBe('amarelo');
  });
  it('líquido < custo → vermelho', () => {
    expect(semaforoTipo(6, 3.84, 4, 3)).toBe('vermelho');
  });
  it('sem mínimo informado → indisponível', () => {
    expect(semaforoTipo(25, 3.5, null, 1.5)).toBe('indisponivel');
  });
});
