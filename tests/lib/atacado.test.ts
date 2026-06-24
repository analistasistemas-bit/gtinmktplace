import { describe, it, expect } from 'vitest';
import { amountComDesconto, validarFaixas } from '@/lib/atacado';

describe('amountComDesconto', () => {
  it('converte % em R$ arredondado', () => {
    expect(amountComDesconto(100, 10)).toBe(90);
    expect(amountComDesconto(12.55, 5)).toBe(11.92);
  });
});

describe('validarFaixas', () => {
  it('aceita vazio', () => expect(validarFaixas([])).toBeNull());
  it('aceita faixas crescentes válidas', () => {
    expect(validarFaixas([{ min_unidades: 5, desconto_pct: 5 }, { min_unidades: 10, desconto_pct: 8 }])).toBeNull();
  });
  it('rejeita min_unidades < 2', () => {
    expect(validarFaixas([{ min_unidades: 1, desconto_pct: 5 }])).toMatch(/≥ 2/);
  });
  it('rejeita desconto fora de 1..99', () => {
    expect(validarFaixas([{ min_unidades: 5, desconto_pct: 0 }])).toMatch(/1% e 99%/);
  });
  it('rejeita desconto não-crescente', () => {
    expect(validarFaixas([{ min_unidades: 5, desconto_pct: 8 }, { min_unidades: 10, desconto_pct: 8 }])).toMatch(/mais desconto/);
  });
  it('rejeita mais de 5 faixas', () => {
    const f = [2, 3, 4, 5, 6, 7].map((n, i) => ({ min_unidades: n, desconto_pct: i + 1 }));
    expect(validarFaixas(f)).toMatch(/Máximo de 5/);
  });
});
