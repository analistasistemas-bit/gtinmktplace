import { describe, it, expect } from 'vitest';
import * as feAtacado from '@/lib/atacado';
import * as beAtacado from '../../supabase/functions/_shared/ml/atacado';

// A fórmula de atacado está duplicada byte-a-byte entre FE (preview ao operador) e BE (valor REAL
// enviado ao ML). Este teste falha assim que as cópias divergirem — drift silencioso em preço é o
// pior bug. Ver plans/016. (Desconto visual removido por completo, ADR-0162 — a metade de
// paridade "de"/desconto saiu junto com `lib/desconto.ts` e `_shared/preco/desconto.ts`.)
const precos = [0, 1, 9.9, 10, 19.99, 100, 1234.56, 9999.99];
const pcts = [-5, 0, 1, 10, 15, 33.33, 50, 99, 100, 120];

describe('paridade FE↔BE: atacado', () => {
  it('amountComDesconto idêntico', () => {
    for (const p of precos)
      for (const pct of pcts)
        expect(feAtacado.amountComDesconto(p, pct)).toBe(beAtacado.amountComDesconto(p, pct));
  });
});
