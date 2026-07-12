import { describe, it, expect } from 'vitest';
import * as fe from '../src/lib/desconto';
import * as be from '../supabase/functions/_shared/preco/desconto';

// Paridade FE<->BE: as duas cópias de desconto.ts devem se comportar
// identicamente. Não unificar (fronteira Vite/Deno) — só travar o contrato.

describe('paridade calcularPrecoDe (FE x BE)', () => {
  const casos: Array<[number, number]> = [
    // happy
    [100, 15],
    [29.9, 10],
    [199.99, 33],
    // bordas null
    [100, 0],
    [100, -5],
    [100, 100],
    [100, 150],
    [0, 15],
    [-1, 15],
    // arredondamento
    [33.33, 17],
  ];

  it.each(casos)('calcularPrecoDe(%s, %s) é igual em FE e BE', (preco, pct) => {
    expect(fe.calcularPrecoDe(preco, pct)).toBe(be.calcularPrecoDe(preco, pct));
  });
});

describe('paridade pctEfetivo (FE x BE)', () => {
  const casos: Array<[number | null, number]> = [
    [null, 15],
    [10, 15],
    [0, 15],
  ];

  it.each(casos)('pctEfetivo(%s, %s) é igual em FE e BE', (familiaPct, globalPct) => {
    expect(fe.pctEfetivo(familiaPct, globalPct)).toBe(be.pctEfetivo(familiaPct, globalPct));
  });
});
