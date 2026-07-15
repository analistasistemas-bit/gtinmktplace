import { describe, it, expect } from 'vitest';
import { liquidoPorCanal } from '@/lib/resumo-por-canal';

describe('liquidoPorCanal', () => {
  it('agrega líquido e pedidos por canal, ordenado por líquido desc', () => {
    const vendas = [
      { canal: 'mercado_livre', liquido: 100 },
      { canal: 'shopee', liquido: 300 },
      { canal: 'mercado_livre', liquido: 50 },
      { liquido: 10 }, // sem canal → mercado_livre
    ];
    expect(liquidoPorCanal(vendas)).toEqual([
      { canal: 'shopee', liquido: 300, pedidos: 1 },
      { canal: 'mercado_livre', liquido: 160, pedidos: 3 },
    ]);
  });
  it('lista vazia → vazio', () => {
    expect(liquidoPorCanal([])).toEqual([]);
  });
});
