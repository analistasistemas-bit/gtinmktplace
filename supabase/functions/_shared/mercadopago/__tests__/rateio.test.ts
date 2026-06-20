import { describe, it, expect } from 'vitest';
import { ratearFreteCompartilhado, type InfoRateio } from '../rateio';
import type { VendaFinanceira } from '../financeiro';

function venda(v: Partial<VendaFinanceira> & { id: string }): VendaFinanceira {
  return {
    data: null, descricao: null, bruto: 0, liquido: 0, retido: 0,
    estorno: 0, custo: null, codigo: null, ...v,
  } as VendaFinanceira;
}

describe('ratearFreteCompartilhado', () => {
  it('redistribui o frete por peso entre as linhas do mesmo envio (zero-soma)', () => {
    // Pack real: Linha (frete todo nela) + Fita N.9. Σ líquido = 35,00.
    const vendas = [
      venda({ id: 'L', bruto: 45.10, liquido: 24.46, retido: 20.64 }),
      venda({ id: 'F', bruto: 12.70, liquido: 10.54, retido: 2.16 }),
    ];
    const info: Record<string, InfoRateio> = {
      L: { tarifa: 7.44, peso: 338, shippingId: 'S1' },
      F: { tarifa: 2.16, peso: 58, shippingId: 'S1' },
    };
    const r = ratearFreteCompartilhado(vendas, info);
    const byId = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(byId.L.liquido).toBe(26.39);
    expect(byId.L.retido).toBe(18.71);
    expect(byId.F.liquido).toBe(8.61);
    expect(byId.F.retido).toBe(4.09);
    expect(byId.L.liquido + byId.F.liquido).toBeCloseTo(35.00, 2);
  });

  it('não altera grupo de um envio só (regressão)', () => {
    const vendas = [venda({ id: 'A', bruto: 45.10, liquido: 24.46, retido: 20.64 })];
    const info = { A: { tarifa: 7.44, peso: 338, shippingId: 'S9' } };
    expect(ratearFreteCompartilhado(vendas, info)).toEqual(vendas);
  });

  it('mantém o grupo cru quando falta peso/tarifa/shippingId de algum membro', () => {
    const vendas = [
      venda({ id: 'L', bruto: 45.10, liquido: 24.46, retido: 20.64 }),
      venda({ id: 'F', bruto: 12.70, liquido: 10.54, retido: 2.16 }),
    ];
    const info = { L: { tarifa: 7.44, peso: 338, shippingId: 'S1' }, F: { shippingId: 'S1' } };
    expect(ratearFreteCompartilhado(vendas, info)).toEqual(vendas);
  });

  it('peso_grupo=0 → rateia por valor (bruto)', () => {
    const vendas = [
      venda({ id: 'L', bruto: 30, liquido: 15, retido: 15 }),
      venda({ id: 'F', bruto: 10, liquido: 9, retido: 1 }),
    ];
    const info = { L: { tarifa: 5, peso: 0, shippingId: 'S1' }, F: { tarifa: 1, peso: 0, shippingId: 'S1' } };
    const r = ratearFreteCompartilhado(vendas, info);
    // frete_grupo = (15+1) - (5+1) = 10; por valor: L 30/40=7,5; F 10/40=2,5
    const byId = Object.fromEntries(r.map((x) => [x.id, x]));
    expect(byId.L.liquido).toBe(17.5); // 30 - 5 - 7,5
    expect(byId.F.liquido).toBe(6.5);  // 10 - 1 - 2,5
    expect(byId.L.liquido + byId.F.liquido).toBe(24);
  });

  it('frete_grupo<0 → mantém cru', () => {
    const vendas = [
      venda({ id: 'L', bruto: 30, liquido: 28, retido: 2 }),
      venda({ id: 'F', bruto: 10, liquido: 9, retido: 1 }),
    ];
    const info = { L: { tarifa: 5, peso: 1, shippingId: 'S1' }, F: { tarifa: 5, peso: 1, shippingId: 'S1' } };
    expect(ratearFreteCompartilhado(vendas, info)).toEqual(vendas);
  });
});
