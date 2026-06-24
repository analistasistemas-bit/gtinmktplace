import { describe, it, expect } from 'vitest';
import { montarCsv } from '@/lib/csv';

describe('montarCsv', () => {
  it('gera cabeçalho + linhas com ; e escapa aspas/; ', () => {
    const csv = montarCsv(
      [{ a: 'fita "azul"; 10m', b: 12.5, c: null }],
      [{ chave: 'a', titulo: 'Produto' }, { chave: 'b', titulo: 'Valor' }, { chave: 'c', titulo: 'X' }],
    );
    expect(csv).toBe('Produto;Valor;X\n"fita ""azul""; 10m";12.5;');
  });
});
