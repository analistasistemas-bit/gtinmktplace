import { describe, it, expect, vi } from 'vitest';
import { sugerirPrecoVenda, grossUp, freteEstavelGrossUp } from '../sugerir';

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
      reancorado: false,
    });
  });
  it('concorrente R$ 12 → 11,40 cairia abaixo do abismo → piso ADR-0075 empurra pra 12,55', () => {
    const r = sugerirPrecoVenda(10, { vendedores: 5, preco_min: 12 }, { percentual: 30, fixa: 6 });
    expect(r.estrategia).toBe('competitivo');
    expect(r.preco).toBeCloseTo(12.55, 2);
    expect(r.motivo).toContain('abismo de tarifa fixa');
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
    expect(r.reancorado).toBe(false);
  });
});

describe('sugerirPrecoVenda — re-âncora competitiva no piso-líder (7º parâmetro)', () => {
  const comissao = { percentual: 11.5, fixa: 0 };
  const frete = 6.55;
  const aliquota = 8;

  it('1. reancora ausente/ativa:false → comportamento atual inalterado', () => {
    const semParam = sugerirPrecoVenda(0, { vendedores: 5, preco_min: 22.39 }, null, frete, aliquota);
    const comAtivaFalse = sugerirPrecoVenda(0, { vendedores: 5, preco_min: 22.39 }, null, frete, aliquota, 5, {
      ativa: false,
      precoAncoraLider: 25.73,
      custo: 12.79,
      comissao,
    });
    expect(semParam).toEqual({ preco: 21.25, estrategia: 'competitivo', motivo: 'concorrência presente — 5% abaixo do menor preço', reancorado: false });
    expect(comAtivaFalse).toEqual(semParam);
  });

  it('2. ativa:true mas líquido competitivo ≥ custo (sem 🔴) → sem re-âncora', () => {
    const r = sugerirPrecoVenda(0, { vendedores: 5, preco_min: 22.39 }, null, frete, aliquota, 5, {
      ativa: true,
      precoAncoraLider: 25.73,
      custo: 9, // liquido(21.25) ≈ 10,56 ≥ 9 → não é prejuízo
      comissao,
    });
    expect(r.preco).toBeCloseTo(21.25, 2);
    expect(r.reancorado).toBe(false);
  });

  it('3. ativa:true, 🔴, precoAncoraLider:null → sem re-âncora', () => {
    const r = sugerirPrecoVenda(0, { vendedores: 5, preco_min: 22.39 }, null, frete, aliquota, 5, {
      ativa: true,
      precoAncoraLider: null,
      custo: 12.79, // liquido(21.25) ≈ 10,56 < 12,79 → 🔴
      comissao,
    });
    expect(r.preco).toBeCloseTo(21.25, 2);
    expect(r.reancorado).toBe(false);
  });

  it('4. ativa:true, 🔴, precoAncoraLider > preco_min → re-ancora no precoAncoraLider', () => {
    const r = sugerirPrecoVenda(0, { vendedores: 5, preco_min: 22.39 }, null, frete, aliquota, 5, {
      ativa: true,
      precoAncoraLider: 25.73,
      custo: 12.79,
      comissao,
    });
    expect(r.estrategia).toBe('competitivo');
    expect(r.reancorado).toBe(true);
    expect(r.preco).toBeCloseTo(24.45, 2); // arredondar5Proximo(25.73 * 0.95)
    expect(r.preco).toBeLessThanOrEqual(25.73);
    expect(r.motivo).toContain('maior vendedor MercadoLíder');
    expect(r.motivo).toContain('25.73');
  });

  it('5. ativa:true, 🔴, e mesmo precoAncoraLider−desc ainda dá prejuízo → ainda re-ancora (sem gross-up, sem exceder precoAncoraLider)', () => {
    const r = sugerirPrecoVenda(0, { vendedores: 5, preco_min: 10 }, null, 0, 0, 5, {
      ativa: true,
      precoAncoraLider: 12,
      custo: 1000, // nenhum preço competitivo cobriria esse custo
      comissao,
    });
    expect(r.estrategia).toBe('competitivo');
    expect(r.reancorado).toBe(true);
    // ADR-0075: 12*0.95=11,40 cairia abaixo do abismo → piso de R$12,55 tem precedência,
    // mesmo excedendo o precoAncoraLider (12) — refina a garantia "nunca excede" do ADR-0065.
    expect(r.preco).toBeCloseTo(12.55, 2);
    // 🔴 honesto: líquido no preço floorado ainda fica abaixo do custo
    expect(r.preco - r.preco * 0.115 - 1000).toBeLessThan(0);
  });

  it('6. ramo próprio (sem concorrência) → reancorado:false mesmo com reancora.ativa:true', () => {
    const r = sugerirPrecoVenda(20, { vendedores: 0, preco_min: null }, { percentual: 13, fixa: 0 }, 0, 0, 5, {
      ativa: true,
      precoAncoraLider: 100,
      custo: 0,
      comissao,
    });
    expect(r.estrategia).toBe('proprio');
    expect(r.reancorado).toBe(false);
  });

  it('7. borda: precoAncoraLider === preco_min (comparação estrita >) → sem re-âncora', () => {
    const r = sugerirPrecoVenda(0, { vendedores: 5, preco_min: 25.73 }, null, frete, aliquota, 5, {
      ativa: true,
      precoAncoraLider: 25.73,
      custo: 1000, // 🔴 garantido
      comissao,
    });
    const semReancora = sugerirPrecoVenda(0, { vendedores: 5, preco_min: 25.73 }, null, frete, aliquota, 5);
    expect(r.reancorado).toBe(false);
    expect(r.preco).toBeCloseTo(semReancora.preco, 2);
    expect(r.preco).toBeCloseTo(24.45, 2);
  });
});

// ADR-0075: lote #34 (Anne 65) — concorrência real abaixo de R$12,55 não pode mais sair assim
// no ramo competitivo, pela tarifa fixa do ML abaixo do abismo (ADR-0023).
describe('sugerirPrecoVenda — piso do abismo de tarifa fixa também no competitivo (ADR-0075)', () => {
  it('concorrência R$ 10 (5%) → 9,50 cairia abaixo do abismo → floora em R$ 12,55', () => {
    const r = sugerirPrecoVenda(0, { vendedores: 2, preco_min: 10 }, null);
    expect(r.estrategia).toBe('competitivo');
    expect(r.preco).toBeCloseTo(12.55, 2);
    expect(r.motivo).toBe('concorrência abaixo de R$12.55 — abismo de tarifa fixa do ML (ADR-0023); piso aplicado');
    expect(r.reancorado).toBe(false);
  });

  it('concorrência já acima do abismo (R$ 30, 5%) → 28,50, sem piso, motivo inalterado', () => {
    const r = sugerirPrecoVenda(0, { vendedores: 3, preco_min: 30 }, null);
    expect(r.preco).toBeCloseTo(28.5, 2);
    expect(r.motivo).toBe('concorrência presente — 5% abaixo do menor preço');
  });

  it('borda: concorrência que resulta em exatamente R$ 12,55 → não aciona o motivo do piso', () => {
    // 13,2105... × 0,95 arredonda pra 12,55 sem precisar do Math.max
    const r = sugerirPrecoVenda(0, { vendedores: 2, preco_min: 13.21 }, null);
    expect(r.preco).toBeCloseTo(12.55, 2);
    expect(r.motivo).toBe('concorrência presente — 5% abaixo do menor preço');
  });

  it('ramo próprio permanece inalterado (piso já existia desde o ADR-0023)', () => {
    const r = sugerirPrecoVenda(4, { vendedores: 0, preco_min: null }, null);
    expect(r.estrategia).toBe('proprio');
    expect(r.preco).toBeCloseTo(12.55, 2);
    expect(r.motivo).toBe('sem concorrência — comissão indisponível, usando o piso');
  });
});

// ADR-0076: o frete grátis do vendedor salta ao cruzar faixas do ML (~R$79); o gross-up de
// passada única subestima o frete quando o preço final cai numa faixa mais cara. Itera até
// estabilizar e devolve o frete no preço convergido.
describe('freteEstavelGrossUp (ADR-0076)', () => {
  // frete grátis do vendedor: R$6,75 abaixo de R$79, salta para R$16,15 ao cruzar (caso real fitas).
  const freteFaixa = (preco: number) => (preco < 79 ? 6.75 : 16.15);

  it('frete flat → estabiliza no 1º valor (cor barata, piso 22,50) — inalterado', async () => {
    const fake = vi.fn(async () => 6.75);
    const frete = await freteEstavelGrossUp(22.5, 12, 0, 8, fake);
    expect(frete).toBe(6.75);
    // reproduz o preço de hoje: (22,50+6,75)/0,80 = 36,60
    expect(grossUp(22.5, 12, 0, frete, 8)).toBeCloseTo(36.6, 2);
  });

  it('cor cara (piso 78) cruza os R$79 → frete estabiliza em 16,15 → preço 117,70 (não 105,95)', async () => {
    const frete = await freteEstavelGrossUp(78, 12, 0, 8, freteFaixa);
    expect(frete).toBe(16.15);
    const preco = grossUp(78, 12, 0, frete, 8);
    expect(preco).toBeCloseTo(117.7, 2);
    // a passada única (frete família 6,75) dava 105,95, cujo líquido < piso
    expect(grossUp(78, 12, 0, 6.75, 8)).toBeCloseTo(105.95, 2);
  });

  it('itera de verdade quando a 1ª passada fica abaixo da faixa mas o preço final cruza (piso 60)', async () => {
    const fake = vi.fn(freteFaixa);
    const frete = await freteEstavelGrossUp(60, 12, 0, 8, fake);
    // 1ª passada = 75,00 (<79 → 6,75) → 83,45 (≥79 → 16,15) → 95,20 (estável)
    expect(frete).toBe(16.15);
    expect(grossUp(60, 12, 0, frete, 8)).toBeCloseTo(95.2, 2);
    expect(fake.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('respeita maxIter e não trava se o frete nunca estabiliza', async () => {
    const fake = vi.fn((preco: number) => preco); // absurdo: frete = preço, sempre sobe
    const frete = await freteEstavelGrossUp(20, 12, 0, 8, fake, 3);
    expect(fake).toHaveBeenCalledTimes(3);
    expect(Number.isFinite(frete)).toBe(true);
  });
});
