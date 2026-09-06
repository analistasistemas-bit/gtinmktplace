import { describe, it, expect } from 'vitest';
import { calcularMargemKit, type ComponenteKit, type EntradaMargemKit } from '../margem';

const comp = (p: Partial<ComponenteKit> & { ordem: number }): ComponenteKit => ({
  precoAtualML: 100,
  quantidade: 1,
  custo: 10,
  origem: 'nacional',
  ...p,
});

const entrada = (p: Partial<EntradaMargemKit>): EntradaMargemKit => ({
  componentes: [comp({ ordem: 1 })],
  descontoPct: 0,
  comissao: { percentual: 12, fixa: 0 },
  frete: 0,
  aliquotas: { nacional: 8, importado: 16 },
  ...p,
});

describe('calcularMargemKit — rateio', () => {
  it('gabarito oficial do ML: kit 114 / soma 250 → fator 0,456; 100×1 → 45,60; 50×3 → 22,80 (total 68,40)', () => {
    const r = calcularMargemKit(entrada({
      componentes: [
        comp({ ordem: 1, precoAtualML: 100, quantidade: 1 }),
        comp({ ordem: 2, precoAtualML: 50, quantidade: 3 }),
      ],
      descontoPct: 0.544,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.precoKit).toBe(114);
    expect(r.rateio[0]).toMatchObject({ ordem: 1, unitAmount: 45.6, totalAmount: 45.6 });
    expect(r.rateio[1]).toMatchObject({ ordem: 2, unitAmount: 22.8, totalAmount: 68.4 });
  });

  it('arredondamento é round2 (centavos), NÃO o passo de R$ 0,05: 33,30 × 0,9 → 29,97', () => {
    const r = calcularMargemKit(entrada({
      componentes: [
        comp({ ordem: 1, precoAtualML: 33.3, quantidade: 1 }),
        comp({ ordem: 2, precoAtualML: 66.7, quantidade: 1 }),
      ],
      descontoPct: 0.1,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.precoKit).toBe(90);
    expect(r.rateio[0].unitAmount).toBe(29.97);
    expect(r.rateio[1].unitAmount).toBe(60.03);
  });

  it('desconto 0 → preço do kit = soma dos componentes e rateio = preço de cada um', () => {
    const r = calcularMargemKit(entrada({
      componentes: [
        comp({ ordem: 1, precoAtualML: 100, quantidade: 1 }),
        comp({ ordem: 2, precoAtualML: 150, quantidade: 1 }),
      ],
      descontoPct: 0,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.precoKit).toBe(250);
    expect(r.rateio.map((c) => c.totalAmount)).toEqual([100, 150]);
  });
});

describe('calcularMargemKit — imposto por componente (ADR-0154 D7)', () => {
  it('kit misto: imposto = 8% da parcela nacional + 16% da importada, ≠ alíquota do principal no kit todo', () => {
    const r = calcularMargemKit(entrada({
      componentes: [
        comp({ ordem: 1, precoAtualML: 100, quantidade: 1, custo: 40, origem: 'nacional' }),
        comp({ ordem: 2, precoAtualML: 150, quantidade: 1, custo: 60, origem: 'importado' }),
      ],
      descontoPct: 0.2,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.precoKit).toBe(200);
    expect(r.rateio[0].imposto).toBe(6.4); // 80 × 8%
    expect(r.rateio[1].imposto).toBe(19.2); // 120 × 16%
    expect(r.impostoTotal).toBe(25.6);
    // A alíquota do principal (nacional) sobre o kit inteiro daria 16,00 — 9,60 a menos.
    expect(r.impostoTotal).not.toBe(200 * 0.08);
    expect(r.custoTotal).toBe(100);
    expect(r.liquido).toBeCloseTo(150.4, 8); // 200 − 24 de comissão − 25,60 de imposto
    expect(r.margemPct).toBeCloseTo(25.2, 8); // (150,40 − 100) / 200
  });

  it('quantidade multiplica custo e imposto do componente', () => {
    const r = calcularMargemKit(entrada({
      componentes: [comp({ ordem: 1, precoAtualML: 50, quantidade: 3, custo: 20, origem: 'importado' })],
      descontoPct: 0,
      comissao: { percentual: 0, fixa: 0 },
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.precoKit).toBe(150);
    expect(r.rateio[0]).toMatchObject({ unitAmount: 50, totalAmount: 150, imposto: 24 });
    expect(r.custoTotal).toBe(60);
  });

  it('frete absorvido pelo vendedor sai do líquido', () => {
    const r = calcularMargemKit(entrada({
      componentes: [comp({ ordem: 1, precoAtualML: 100, quantidade: 1, custo: 0 })],
      descontoPct: 0,
      comissao: { percentual: 10, fixa: 5 },
      frete: 20,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.liquido).toBeCloseTo(57, 8); // 100 − 10 − 5 − 20 − 8
  });
});

describe('calcularMargemKit — margem negativa não bloqueia (ADR-0154 D6)', () => {
  it('desconto agressivo devolve ok:true com margemPct negativa', () => {
    const r = calcularMargemKit(entrada({
      componentes: [
        comp({ ordem: 1, precoAtualML: 100, quantidade: 1, custo: 40, origem: 'nacional' }),
        comp({ ordem: 2, precoAtualML: 150, quantidade: 1, custo: 60, origem: 'importado' }),
      ],
      descontoPct: 0.7,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.precoKit).toBe(75);
    expect(r.impostoTotal).toBe(9.6); // 30×8% + 45×16%
    expect(r.liquido).toBeCloseTo(56.4, 8); // 75 − 9 de comissão − 9,60
    expect(r.margemPct).toBeCloseTo(-58.133333, 5);
    expect(r.margemPct).toBeLessThan(0);
  });
});

describe('calcularMargemKit — dado ausente nunca vira número (ADR-0107 / D6)', () => {
  it('custo faltando em 1 de 3 componentes → ok:false apontando a ordem', () => {
    const r = calcularMargemKit(entrada({
      componentes: [comp({ ordem: 1 }), comp({ ordem: 2, custo: null }), comp({ ordem: 3 })],
    }));
    expect(r).toEqual({ ok: false, faltando: [{ ordem: 2, campo: 'custo' }] });
  });

  it('origem faltando → campo origem', () => {
    const r = calcularMargemKit(entrada({
      componentes: [comp({ ordem: 1 }), comp({ ordem: 2, origem: null })],
    }));
    expect(r).toEqual({ ok: false, faltando: [{ ordem: 2, campo: 'origem' }] });
  });

  it('alíquotas não confirmadas na org → ok:false com ordem -1', () => {
    const r = calcularMargemKit(entrada({ aliquotas: null }));
    expect(r).toEqual({ ok: false, faltando: [{ ordem: -1, campo: 'aliquotas' }] });
  });

  it('comissão indisponível → ok:false com ordem -1 (nunca comissão 0 silenciosa)', () => {
    const r = calcularMargemKit(entrada({ comissao: null }));
    expect(r).toEqual({ ok: false, faltando: [{ ordem: -1, campo: 'comissao' }] });
  });

  it('faltando é determinístico: componentes por ordem crescente, depois comissao, depois aliquotas', () => {
    const r = calcularMargemKit(entrada({
      componentes: [
        comp({ ordem: 3, custo: null, origem: null }),
        comp({ ordem: 1, custo: null }),
      ],
      comissao: null,
      aliquotas: null,
    }));
    expect(r).toEqual({
      ok: false,
      faltando: [
        { ordem: 1, campo: 'custo' },
        { ordem: 3, campo: 'custo' },
        { ordem: 3, campo: 'origem' },
        { ordem: -1, campo: 'comissao' },
        { ordem: -1, campo: 'aliquotas' },
      ],
    });
  });

  it('nenhum campo do resultado ok:true é NaN', () => {
    const r = calcularMargemKit(entrada({
      componentes: [comp({ ordem: 1, precoAtualML: 19.99, quantidade: 2, custo: 7.77 })],
      descontoPct: 0.15,
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const v of [r.precoKit, r.custoTotal, r.impostoTotal, r.liquido, r.margemPct]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('calcularMargemKit — precondição estrutural', () => {
  it('preço do kit zerado (sem componentes) explode em vez de devolver 0/NaN', () => {
    expect(() => calcularMargemKit(entrada({ componentes: [] }))).toThrow(/preço/i);
  });

  it('desconto de 100% explode: kit de graça não é resultado de margem', () => {
    expect(() => calcularMargemKit(entrada({ descontoPct: 1 }))).toThrow(/preço/i);
  });
});
