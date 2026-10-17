// ADR-0181 — produtosCadastradosDaNota: dedupe por nItem e descarte de refNota de outra nota.
// Emenda 2026-10-17: sugestão de distribuição por item e prova positiva de 1ª entrada.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Linha = Record<string, unknown>;
const linhas = vi.hoisted(() => ({
  v: [] as Linha[],
  tabelas: {} as Record<string, Linha[]>,
  erro: null as string | null,
}));
vi.mock('@/lib/supabase', () => {
  const resposta = (t: string) => (linhas.erro === t
    ? { data: null, error: { message: 'falhou' } }
    : { data: t === 'familias' && !linhas.tabelas.familias ? linhas.v : (linhas.tabelas[t] ?? []), error: null });
  const from = (t: string) => {
    const q: Record<string, unknown> = {};
    for (const k of ['select', 'eq', 'like', 'order', 'in', 'limit']) q[k] = () => q;
    q.range = () => Promise.resolve(resposta(t));
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resposta(t)).then(ok, ko);
    return q;
  };
  return { supabase: { from } };
});

import { primeiraEntradaComprovada, produtosCadastradosDaNota } from '../notas-compra';

const CH = '1'.repeat(44);
const OUTRA = '2'.repeat(44);

beforeEach(() => { linhas.v = []; linhas.tabelas = {}; linhas.erro = null; });

describe('produtosCadastradosDaNota', () => {
  it('mesmo codigo_pai em duas versões da mesma refNota -> 1 candidato', async () => {
    linhas.v = [{ codigo_pai: 'P1', ref: `nfe:${CH}:1` }, { codigo_pai: 'P1', ref: `nfe:${CH}:1` }];
    expect(await produtosCadastradosDaNota(CH)).toEqual([{ nItem: 1, codigosPai: ['P1'], sugestao: null }]);
  });
  it('codigo_pai diferentes no mesmo nItem -> 2 candidatos', async () => {
    linhas.v = [{ codigo_pai: 'P1', ref: `nfe:${CH}:2` }, { codigo_pai: 'P2', ref: `nfe:${CH}:2` }];
    expect(await produtosCadastradosDaNota(CH)).toEqual([{ nItem: 2, codigosPai: ['P1', 'P2'], sugestao: null }]);
  });
  it('refNota de outra nota (ou inválida) é ignorada', async () => {
    linhas.v = [{ codigo_pai: 'P9', ref: `nfe:${OUTRA}:1` }, { codigo_pai: 'P8', ref: null }, { codigo_pai: 'P1', ref: `nfe:${CH}:3` }];
    expect(await produtosCadastradosDaNota(CH)).toEqual([{ nItem: 3, codigosPai: ['P1'], sugestao: null }]);
  });
  it('devolve a sugestão gravada; versões com sugestões diferentes → a mais recente por criado_em', async () => {
    const s = (q: number) => ({ fator: 12, linhas: [{ codigo: 'S1', quantidade: q }] });
    linhas.v = [
      { codigo_pai: 'P1', ref: `nfe:${CH}:1`, criado_em: '2026-10-17T10:00:00Z', sugestao: s(30) },
      { codigo_pai: 'P1', ref: `nfe:${CH}:1`, criado_em: '2026-10-17T12:00:00Z', sugestao: s(24) },
      { codigo_pai: 'P1', ref: `nfe:${CH}:1`, criado_em: '2026-10-17T11:00:00Z', sugestao: s(10) },
    ];
    expect(await produtosCadastradosDaNota(CH)).toEqual([{ nItem: 1, codigosPai: ['P1'], sugestao: s(24) }]);
  });
  it('sugestão malformada é ignorada (null)', async () => {
    linhas.v = [{ codigo_pai: 'P1', ref: `nfe:${CH}:1`, criado_em: '2026-10-17T10:00:00Z', sugestao: { fator: 0, linhas: 'x' } }];
    expect((await produtosCadastradosDaNota(CH))[0].sugestao).toBeNull();
  });
});

describe('primeiraEntradaComprovada (prova positiva, D-9 emenda 2026-10-17)', () => {
  const fam = (origem: string | null) => [
    { id: 'f1', origem_cadastro: origem, criado_em: '2026-10-16T22:45:00Z' },
    { id: 'f2', origem_cadastro: null, criado_em: '2026-10-17T10:00:00Z' },
  ];
  it("origem 'nota' + sem movimentos + saldo 0 em todas as versões ⇒ true", async () => {
    linhas.tabelas = { familias: fam('nota'), variacoes: [{ codigo: 'S1', estoque: 0 }, { codigo: 'S1', estoque: '0' }], estoque_movimentos: [] };
    expect(await primeiraEntradaComprovada('00000010')).toBe(true);
  });
  it('produto de planilha/manual (origem ≠ nota) ⇒ false', async () => {
    linhas.tabelas = { familias: fam(null), variacoes: [{ codigo: 'S1', estoque: 0 }], estoque_movimentos: [] };
    expect(await primeiraEntradaComprovada('P')).toBe(false);
  });
  it('entrada anterior (movimento, mesmo com saldo zerado depois) ⇒ false', async () => {
    linhas.tabelas = { familias: fam('nota'), variacoes: [{ codigo: 'S1', estoque: 0 }], estoque_movimentos: [{ id: 1 }] };
    expect(await primeiraEntradaComprovada('P')).toBe(false);
  });
  it('versão com estoque > 0 ⇒ false', async () => {
    linhas.tabelas = { familias: fam('nota'), variacoes: [{ codigo: 'S1', estoque: 0 }, { codigo: 'S1', estoque: 4 }], estoque_movimentos: [] };
    expect(await primeiraEntradaComprovada('P')).toBe(false);
  });
  it('vazio não é prova: sem família ou sem SKU ⇒ false', async () => {
    linhas.tabelas = { familias: [], variacoes: [], estoque_movimentos: [] };
    expect(await primeiraEntradaComprovada('P')).toBe(false);
    linhas.tabelas = { familias: fam('nota'), variacoes: [], estoque_movimentos: [] };
    expect(await primeiraEntradaComprovada('P')).toBe(false);
  });
  it('falha de consulta lança (o chamador cai no custo da nota)', async () => {
    linhas.tabelas = { familias: fam('nota'), variacoes: [{ codigo: 'S1', estoque: 0 }], estoque_movimentos: [] };
    linhas.erro = 'estoque_movimentos';
    await expect(primeiraEntradaComprovada('P')).rejects.toThrow();
  });
});
