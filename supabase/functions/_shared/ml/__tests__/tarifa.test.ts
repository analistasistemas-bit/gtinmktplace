import { describe, it, expect } from 'vitest';
import { montarTarifa } from '../tarifa';

const classico = { sale_fee_amount: 7.68, sale_fee_details: { percentage_fee: 11.5, fixed_fee: 6.24 } };
const premium = { sale_fee_amount: 8.30, sale_fee_details: { percentage_fee: 16.5, fixed_fee: 6.24 } };

describe('montarTarifa', () => {
  it('decompõe comissão e calcula o líquido (recebe = preço - comissão)', () => {
    const t = montarTarifa(12.50, classico, premium);
    expect(t.classico).toEqual({ comissao: 7.68, percentual: 11.5, fixa: 6.24, recebe: 4.82 });
    expect(t.premium).toEqual({ comissao: 8.30, percentual: 16.5, fixa: 6.24, recebe: 4.20 });
  });
  it('arredonda o líquido para 2 casas', () => {
    const t = montarTarifa(10, { sale_fee_amount: 3.333, sale_fee_details: { percentage_fee: 12, fixed_fee: 2.13 } }, premium);
    expect(t.classico.recebe).toBe(6.67);
  });
  it('item acima de R$29 não tem tarifa fixa (fixed_fee 0)', () => {
    const semFixa = { sale_fee_amount: 3.6, sale_fee_details: { percentage_fee: 12, fixed_fee: 0 } };
    const t = montarTarifa(30, semFixa, semFixa);
    expect(t.classico.fixa).toBe(0);
    expect(t.classico.recebe).toBe(26.4);
  });
  it('tolera sale_fee_details ausente (assume 0 em % e fixa)', () => {
    const t = montarTarifa(20, { sale_fee_amount: 2.3 }, { sale_fee_amount: 2.3 });
    expect(t.classico.percentual).toBe(0);
    expect(t.classico.fixa).toBe(0);
    expect(t.classico.recebe).toBe(17.7);
  });
  it('frete default 0: recebe = preço - comissão (retrocompat)', () => {
    expect(montarTarifa(12.50, classico, premium).frete).toBe(0);
  });
  it('desconta o frete do vendedor do líquido (mesmo p/ Clássico e Premium)', () => {
    // Espelha o caso do simulador ML: 29,90 − comissão − 6,55 de frete.
    const c = { sale_fee_amount: 4.93, sale_fee_details: { percentage_fee: 16.5, fixed_fee: 0 } };
    const t = montarTarifa(29.90, c, c, 6.55);
    expect(t.frete).toBe(6.55);
    expect(t.classico.recebe).toBe(18.42); // 29.90 - 4.93 - 6.55
    expect(t.premium.recebe).toBe(18.42);
  });
});
