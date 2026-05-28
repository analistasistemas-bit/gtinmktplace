import { describe, it, expect } from 'vitest';
import { pool } from '../pool';

describe('pool', () => {
  it('processa todos os itens', async () => {
    const itens = [1, 2, 3, 4, 5];
    const resultado = await pool(2, itens, async (n) => n * 2);
    expect(resultado).toEqual([2, 4, 6, 8, 10]);
  });

  it('respeita o limite de concorrência', async () => {
    let emVoo = 0;
    let picoConcorrencia = 0;
    const itens = [1, 2, 3, 4, 5, 6, 7, 8];
    await pool(3, itens, async (n) => {
      emVoo++;
      picoConcorrencia = Math.max(picoConcorrencia, emVoo);
      await new Promise((r) => setTimeout(r, 10));
      emVoo--;
      return n;
    });
    expect(picoConcorrencia).toBeLessThanOrEqual(3);
  });

  it('preserva ordem do array de saída', async () => {
    const itens = [10, 20, 30];
    const resultado = await pool(2, itens, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n + 1;
    });
    expect(resultado).toEqual([11, 21, 31]);
  });

  it('propaga erros do worker', async () => {
    const itens = [1, 2, 3];
    await expect(pool(2, itens, async (n) => {
      if (n === 2) throw new Error('boom');
      return n;
    })).rejects.toThrow('boom');
  });

  it('lista vazia retorna array vazio', async () => {
    expect(await pool(5, [], async (n) => n)).toEqual([]);
  });
});
