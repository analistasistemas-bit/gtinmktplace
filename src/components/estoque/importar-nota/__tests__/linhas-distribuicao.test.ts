import { describe, it, expect } from 'vitest';
import { linhasIniciais, semearDistribuicao } from '../estado';

describe('linhasIniciais', () => {
  it('1 SKU recebe o total; vários SKUs começam zerados com o custo default', () => {
    expect(linhasIniciais([{ codigo: 'S1' }], 35, 10)).toEqual([{ codigo: 'S1', quantidade: 35, custoPrecificacao: 10 }]);
    expect(linhasIniciais([{ codigo: 'S1' }, { codigo: 'S2' }], 35, 10)).toEqual([
      { codigo: 'S1', quantidade: 0, custoPrecificacao: 10 }, { codigo: 'S2', quantidade: 0, custoPrecificacao: 10 }]);
  });
});

describe('semearDistribuicao', () => {
  it('sem linha salva usa linhasIniciais', () => {
    expect(semearDistribuicao([{ codigo: 'S1' }], [], 35, 10)).toEqual(linhasIniciais([{ codigo: 'S1' }], 35, 10));
  });
  it('preserva quantidade, custo editado e SKU de outro produto; SKU sem linha entra zerado', () => {
    const salva = [
      { codigo: 'S1', quantidade: 20, custoPrecificacao: 12.5 },
      { codigo: 'X9', quantidade: 15, custoPrecificacao: 8, codigoPai: 'OUTRO' },
    ];
    expect(semearDistribuicao([{ codigo: 'S1' }, { codigo: 'S2' }], salva, 35, 10)).toEqual([
      salva[0], { codigo: 'S2', quantidade: 0, custoPrecificacao: 10 }, salva[1]]);
    // 1 SKU com tudo movido p/ outro produto: não volta a receber o total
    expect(semearDistribuicao([{ codigo: 'S1' }], [salva[1]], 35, 10)).toEqual([
      { codigo: 'S1', quantidade: 0, custoPrecificacao: 10 }, salva[1]]);
  });
});
