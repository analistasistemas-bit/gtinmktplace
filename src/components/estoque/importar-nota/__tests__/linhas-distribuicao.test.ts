import { describe, it, expect } from 'vitest';
import { linhasIniciais } from '../estado';

describe('linhasIniciais', () => {
  it('1 SKU recebe o total; vários SKUs começam zerados com o custo default', () => {
    expect(linhasIniciais([{ codigo: 'S1' }], 35, 10)).toEqual([{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }]);
    expect(linhasIniciais([{ codigo: 'S1' }, { codigo: 'S2' }], 35, 10)).toEqual([
      { codigo: 'S1', quantidade: 0, custoPrecificacao: 10 }, { codigo: 'S2', quantidade: 0, custoPrecificacao: 10 }]);
  });
});
