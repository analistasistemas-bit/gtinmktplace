import { describe, it, expect } from 'vitest';
import { liquidoClassico } from '../liquido';

describe('liquidoClassico', () => {
  it('caso real da tela: 21,70 @ 11,5% + frete 6,55 + imposto 8% → ~10,9185 (R$10,91 na tela)', () => {
    expect(liquidoClassico(21.7, { percentual: 11.5, fixa: 0 }, 6.55, 8)).toBeCloseTo(10.9185, 2);
  });

  it('frete e aliquotaPct default 0 → preço − (preco*pct/100 + fixa)', () => {
    expect(liquidoClassico(100, { percentual: 12, fixa: 0 })).toBeCloseTo(88, 8);
  });

  it('fixa > 0: 12% + R$6 fixa, preço 10 → 10 − (1,2 + 6) = 2,8', () => {
    expect(liquidoClassico(10, { percentual: 12, fixa: 6 })).toBeCloseTo(2.8, 8);
  });

  it('comissao=null → comissão tratada como 0 (subtrai só frete/imposto)', () => {
    expect(liquidoClassico(100, null, 10, 5)).toBeCloseTo(85, 8);
  });

  it('comissao=null, sem frete/imposto → líquido = preço', () => {
    expect(liquidoClassico(100, null)).toBeCloseTo(100, 8);
  });
});
