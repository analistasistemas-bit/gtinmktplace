import { describe, it, expect } from 'vitest';
import { chunk } from '../utils';

describe('chunk', () => {
  it('separa um array em pedaços de tamanho especificado', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7];
    const res = chunk(arr, 3);
    expect(res).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7]
    ]);
  });

  it('retorna array vazio se entrada for vazia', () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it('lida com tamanho de lote maior que o array', () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]]);
  });
});
