// ADR-0181 — produtosCadastradosDaNota: dedupe por nItem e descarte de refNota de outra nota.
import { describe, expect, it, vi } from 'vitest';

const linhas = vi.hoisted(() => ({ v: [] as Array<{ codigo_pai: string; ref: string | null }> }));
vi.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {};
  for (const k of ['select', 'eq', 'like', 'order']) q[k] = () => q;
  q.range = () => Promise.resolve({ data: linhas.v, error: null });
  return { supabase: { from: () => q } };
});

import { produtosCadastradosDaNota } from '../notas-compra';

const CH = '1'.repeat(44);
const OUTRA = '2'.repeat(44);

describe('produtosCadastradosDaNota', () => {
  it('mesmo codigo_pai em duas versões da mesma refNota -> 1 candidato', async () => {
    linhas.v = [{ codigo_pai: 'P1', ref: `nfe:${CH}:1` }, { codigo_pai: 'P1', ref: `nfe:${CH}:1` }];
    expect(await produtosCadastradosDaNota(CH)).toEqual([{ nItem: 1, codigosPai: ['P1'] }]);
  });
  it('codigo_pai diferentes no mesmo nItem -> 2 candidatos', async () => {
    linhas.v = [{ codigo_pai: 'P1', ref: `nfe:${CH}:2` }, { codigo_pai: 'P2', ref: `nfe:${CH}:2` }];
    expect(await produtosCadastradosDaNota(CH)).toEqual([{ nItem: 2, codigosPai: ['P1', 'P2'] }]);
  });
  it('refNota de outra nota (ou inválida) é ignorada', async () => {
    linhas.v = [{ codigo_pai: 'P9', ref: `nfe:${OUTRA}:1` }, { codigo_pai: 'P8', ref: null }, { codigo_pai: 'P1', ref: `nfe:${CH}:3` }];
    expect(await produtosCadastradosDaNota(CH)).toEqual([{ nItem: 3, codigosPai: ['P1'] }]);
  });
});
