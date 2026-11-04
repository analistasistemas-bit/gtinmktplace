import { describe, expect, it } from 'vitest';
import { comCustoRecente } from '../queries';

describe('comCustoRecente', () => {
  it('troca só o custo pelo mais recente de cada SKU (linhas vêm da mais nova para a mais antiga)', () => {
    const variacoes = [{ codigo: '02436825', custo: 64.0941, preco: 114 }];
    const r = comCustoRecente(variacoes, [{ codigo: '02436825', custo: 63.4027 }, { codigo: '02436825', custo: 64.0941 }]);
    expect(r).toEqual([{ codigo: '02436825', custo: 63.4027, preco: 114 }]);
  });

  it('SKU sem linha recente mantém o custo e nenhuma variação some (UPDATE parcial)', () => {
    const variacoes = [{ codigo: 'A', custo: 10 }, { codigo: 'B', custo: 20 }];
    expect(comCustoRecente(variacoes, [{ codigo: 'A', custo: 12 }])).toEqual([{ codigo: 'A', custo: 12 }, { codigo: 'B', custo: 20 }]);
  });

  it('custo vem do banco como texto e vira número', () => {
    expect(comCustoRecente([{ codigo: 'A', custo: 10 }], [{ codigo: 'A', custo: '63.40' as never }])[0].custo).toBe(63.4);
  });
});
