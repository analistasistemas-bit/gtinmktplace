import { describe, it, expect } from 'vitest';
import { sugerirPrecoVenda, grossUp } from '../sugerir';

describe('grossUp (preço cujo líquido ≥ piso)', () => {
  it('piso 20, 13% + R$ 0 fixa → (20/0,87)=22,99 → arredonda cima 23,00', () => {
    expect(grossUp(20, 13, 0)).toBeCloseTo(23, 2);
  });
  it('piso 20 com tarifa fixa R$ 6 → (26/0,87)=29,88 → 29,90', () => {
    expect(grossUp(20, 13, 6)).toBeCloseTo(29.9, 2);
  });

  // Frete que o vendedor absorve entra no piso: líquido = preço − comissão − frete ≥ piso.
  it('piso 20, 13%, frete R$ 6 → (26/0,87)=29,88 → 29,90', () => {
    expect(grossUp(20, 13, 0, 6)).toBeCloseTo(29.9, 2);
  });
  it('caso real barbante: piso R$ 17,50, 11,5%, frete R$ 6,75 → 27,45 (líquido ≥ 17,50)', () => {
    const preco = grossUp(17.5, 11.5, 0, 6.75);
    expect(preco).toBeCloseTo(27.45, 2);
    // confirma a promessa: o que sobra depois de comissão + frete cobre o piso
    expect(preco - preco * 0.115 - 6.75).toBeGreaterThanOrEqual(17.5);
  });

  // ADR-0023: abaixo de R$ 12,50 o ML cobra 50% de tarifa fixa; o preço é empurrado
  // para o menor múltiplo de 0,05 acima do abismo (R$ 12,55), onde a fixa zera.
  it('piso baixo (R$ 4, 12%) → empurra para o piso acima do abismo (R$ 12,55)', () => {
    expect(grossUp(4, 12, 0)).toBeCloseTo(12.55, 2);
  });
  it('piso R$ 10 (12%) ainda cairia na faixa cara → empurra para R$ 12,55', () => {
    expect(grossUp(10, 12, 0)).toBeCloseTo(12.55, 2);
  });
  it('piso na fronteira: R$ 11,04/0,88 = 12,545 → arredonda 12,55', () => {
    expect(grossUp(11.04, 12, 0)).toBeCloseTo(12.55, 2);
  });
  it('piso acima da fronteira (R$ 11,50, 12%) → 11,50/0,88=13,06 → 13,10 (passa do abismo)', () => {
    expect(grossUp(11.5, 12, 0)).toBeCloseTo(13.1, 2);
  });

  // ADR-0055: imposto por origem entra no denominador junto com a comissão.
  it('imposto 8% (nacional): piso 17,50, 11,5%, frete 6,75 → (24,25/0,805)=30,12 → 30,15', () => {
    const preco = grossUp(17.5, 11.5, 0, 6.75, 8);
    expect(preco).toBeCloseTo(30.15, 2);
    // líquido após comissão + frete + imposto cobre o piso
    expect(preco - preco * 0.115 - 6.75 - preco * 0.08).toBeGreaterThanOrEqual(17.5);
  });
  it('imposto 16% (importado) sobe o preço vs 8%', () => {
    expect(grossUp(17.5, 11.5, 0, 6.75, 16)).toBeGreaterThan(grossUp(17.5, 11.5, 0, 6.75, 8));
  });
  it('guard: comissão + imposto ≥ 100% não divide por ≤0 → cai no piso acima do abismo', () => {
    expect(grossUp(20, 90, 0, 0, 15)).toBeCloseTo(20, 2);
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
    expect(r.motivo).toBe('sem concorrência — preço cobre seu mínimo após comissão e frete');
  });
  it('sem concorrente com comissão + frete → gross-up cobre comissão E frete', () => {
    const r = sugerirPrecoVenda(17.5, { vendedores: 0, preco_min: null }, { percentual: 11.5, fixa: 0 }, 6.75);
    expect(r.estrategia).toBe('proprio');
    expect(r.preco).toBeCloseTo(27.45, 2);
  });
  it('sem concorrente sem comissão → proprio fallback (usa o piso)', () => {
    const r = sugerirPrecoVenda(20.001, { vendedores: 0, preco_min: null }, null);
    expect(r.estrategia).toBe('proprio');
    expect(r.preco).toBeCloseTo(20.05, 2);
    expect(r.motivo).toBe('sem concorrência — comissão indisponível, usando o piso');
  });
  it('fallback (sem comissão) com piso baixo → empurra para R$ 12,55 (fora da faixa cara)', () => {
    const r = sugerirPrecoVenda(4, { vendedores: 0, preco_min: null }, null);
    expect(r.estrategia).toBe('proprio');
    expect(r.preco).toBeCloseTo(12.55, 2);
  });
  it('vendedores > 0 mas sem preco_min → trata como sem concorrente', () => {
    const r = sugerirPrecoVenda(20, { vendedores: 6, preco_min: null }, { percentual: 13, fixa: 0 });
    expect(r.estrategia).toBe('proprio');
    expect(r.preco).toBeCloseTo(23, 2);
  });

  // ADR-0059: percentual configurável (default 5% quando omitido).
  it('descontoConcorrenciaPct customizado (10%) → menor × 0,90', () => {
    const r = sugerirPrecoVenda(10, { vendedores: 3, preco_min: 30 }, null, 0, 0, 10);
    expect(r.preco).toBeCloseTo(27, 2);
    expect(r.motivo).toBe('concorrência presente — 10% abaixo do menor preço');
  });
});
