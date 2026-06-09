import { describe, it, expect } from 'vitest';
import { sugerirPrecoVenda, grossUp } from '../sugerir';

describe('grossUp (preço cujo líquido ≥ piso)', () => {
  it('piso 20, 13% + R$ 0 fixa → (20/0,87)=22,99 → arredonda cima 23,00', () => {
    expect(grossUp(20, 13, 0)).toBeCloseTo(23, 2);
  });
  it('piso 20 com tarifa fixa R$ 6 → (26/0,87)=29,88 → 29,90', () => {
    expect(grossUp(20, 13, 6)).toBeCloseTo(29.9, 2);
  });
});

describe('sugerirPrecoVenda', () => {
  it('com concorrente → competitivo (menor × 0,95, arredonda próximo)', () => {
    expect(sugerirPrecoVenda(10, { vendedores: 3, preco_min: 30 }, null)).toEqual({
      preco: 28.5,
      estrategia: 'competitivo',
      motivo: 'concorrência presente — 5% abaixo do menor preço',
    });
  });
  it('concorrente R$ 12 → 11,40 competitivo (ignora comissão no preço)', () => {
    const r = sugerirPrecoVenda(10, { vendedores: 5, preco_min: 12 }, { percentual: 30, fixa: 6 });
    expect(r.estrategia).toBe('competitivo');
    expect(r.preco).toBeCloseTo(11.4, 2);
  });
  it('sem concorrente com comissão → proprio (gross-up)', () => {
    const r = sugerirPrecoVenda(20, { vendedores: 0, preco_min: null }, { percentual: 13, fixa: 0 });
    expect(r.estrategia).toBe('proprio');
    expect(r.preco).toBeCloseTo(23, 2);
    expect(r.motivo).toBe('sem concorrência — preço cobre seu mínimo após comissão');
  });
  it('sem concorrente sem comissão → proprio fallback (usa o piso)', () => {
    const r = sugerirPrecoVenda(20.001, { vendedores: 0, preco_min: null }, null);
    expect(r.estrategia).toBe('proprio');
    expect(r.preco).toBeCloseTo(20.05, 2);
    expect(r.motivo).toBe('sem concorrência — comissão indisponível, usando o piso');
  });
  it('vendedores > 0 mas sem preco_min → trata como sem concorrente', () => {
    const r = sugerirPrecoVenda(20, { vendedores: 6, preco_min: null }, { percentual: 13, fixa: 0 });
    expect(r.estrategia).toBe('proprio');
    expect(r.preco).toBeCloseTo(23, 2);
  });
});
