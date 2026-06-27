import { describe, it, expect } from 'vitest';
import * as feDesconto from '@/lib/desconto';
import * as feAtacado from '@/lib/atacado';
import * as beDesconto from '../../supabase/functions/_shared/preco/desconto';
import * as beAtacado from '../../supabase/functions/_shared/ml/atacado';

// As fórmulas de preço "de"/desconto e de atacado estão duplicadas byte-a-byte entre FE (preview ao
// operador) e BE (valor REAL enviado ao ML). Este teste falha assim que as cópias divergirem — drift
// silencioso em preço é o pior bug. Ver plans/016.
const precos = [0, 1, 9.9, 10, 19.99, 100, 1234.56, 9999.99];
const pcts = [-5, 0, 1, 10, 15, 33.33, 50, 99, 100, 120];

describe('paridade FE↔BE: preço/desconto/atacado', () => {
  it('calcularPrecoDe idêntico', () => {
    for (const p of precos)
      for (const pct of pcts)
        expect(feDesconto.calcularPrecoDe(p, pct)).toBe(beDesconto.calcularPrecoDe(p, pct));
  });

  it('pctEfetivo idêntico', () => {
    for (const fam of [null, 0, 7, 20])
      for (const g of [10, 15, 30])
        expect(feDesconto.pctEfetivo(fam, g)).toBe(beDesconto.pctEfetivo(fam, g));
  });

  it('amountComDesconto idêntico', () => {
    for (const p of precos)
      for (const pct of pcts)
        expect(feAtacado.amountComDesconto(p, pct)).toBe(beAtacado.amountComDesconto(p, pct));
  });
});
