import { describe, it, expect, vi } from 'vitest';

// O fake respeita o teto de 1000 do PostgREST: cada `.range` devolve só a fatia pedida.
const linhas: Array<{ gtin: string; familias: { codigo_pai: string } }> = [];
const ranges: Array<[number, number]> = [];
vi.mock('@/lib/supabase', () => {
  const q = {
    select: () => q, in: () => q, order: () => q,
    range: (de: number, ate: number) => { ranges.push([de, ate]); return Promise.resolve({ data: linhas.slice(de, ate + 1), error: null }); },
  };
  return { supabase: { from: () => q } };
});

import { produtosPorGtin } from '@/lib/notas-compra';

describe('produtosPorGtin', () => {
  it('GTIN de dois produtos com o 2º depois da linha 1000 não vira falso único', async () => {
    const GTIN = '7891234567895';
    for (let i = 0; i < 1000; i++) linhas.push({ gtin: GTIN, familias: { codigo_pai: '00000100' } });
    linhas.push({ gtin: GTIN, familias: { codigo_pai: '00000200' } });
    expect(await produtosPorGtin([GTIN])).toEqual({ [GTIN]: ['00000100', '00000200'] });
    expect(ranges).toEqual([[0, 999], [1000, 1999]]);
  });
});
