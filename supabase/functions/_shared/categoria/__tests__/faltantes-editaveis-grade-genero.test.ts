import { describe, it, expect } from 'vitest';
import { faltantesEditaveis, contextoFaltantes } from '../faltantes-editaveis';
import type { AtributoSchema } from '../schema';

// ADR-0167: SIZE vem de variacoes.tamanho (grade) e GENDER de familias.genero — o gate já os ignora
// (FALTANTES_IGNORAR); o editor só pode escondê-los quando estão de fato resolvidos.
const A = (o: Partial<AtributoSchema> & { id: string }): AtributoSchema => ({
  nome: o.id, required: false, conditionalRequired: false, valueType: 'string', valores: [], allowedUnits: [], tags: [], ...o,
});
const SCHEMA: AtributoSchema[] = [
  A({ id: 'BRAND', nome: 'Marca', required: true }),
  A({ id: 'SIZE', nome: 'Tamanho', required: true }),
  A({ id: 'GENDER', nome: 'Gênero', required: true, valueType: 'list', valores: [{ id: '339666', nome: 'Masculino' }] }),
];
const ids = (ctx?: { temGrade?: boolean; temGenero?: boolean }) => faltantesEditaveis(SCHEMA, [], ctx).map((c) => c.id);

describe('faltantesEditaveis com contexto de grade/gênero', () => {
  it('grade + gênero gravado → nem SIZE nem GENDER', () => {
    expect(ids({ temGrade: true, temGenero: true })).toEqual(['BRAND']);
  });
  it('sem contexto ou {} → os dois continuam (inalterado)', () => {
    expect(ids()).toEqual(['BRAND', 'SIZE', 'GENDER']);
    expect(ids({})).toEqual(['BRAND', 'SIZE', 'GENDER']);
  });
  it('só grade → lista só GENDER', () => {
    expect(ids({ temGrade: true })).toEqual(['BRAND', 'GENDER']);
  });
  it('só gênero → lista só SIZE', () => {
    expect(ids({ temGenero: true })).toEqual(['BRAND', 'SIZE']);
  });
});

describe('contextoFaltantes (família + variações vivas)', () => {
  const v = (tamanho: string | null, excluida_da_publicacao = false) => ({ tamanho, excluida_da_publicacao });

  it('todas incluídas com tamanho → grade', () => {
    expect(contextoFaltantes('masculino', [v('P'), v('M')])).toEqual({ temGrade: true, temGenero: true });
  });
  it('excluídas não contam (sem tamanho, mas excluída → ainda grade)', () => {
    expect(contextoFaltantes(null, [v('P'), v(null, true)])).toEqual({ temGrade: true, temGenero: false });
  });
  it('tamanho só com espaços = sem tamanho', () => {
    expect(contextoFaltantes(null, [v('   '), v('  ')]).temGrade).toBe(false);
  });
  it('nenhuma incluída → sem grade', () => {
    expect(contextoFaltantes(null, [v('P', true)]).temGrade).toBe(false);
    expect(contextoFaltantes(null, []).temGrade).toBe(false);
  });
  it('família mista → sem grade (SIZE continua editável)', () => {
    const ctx = contextoFaltantes(null, [v('P'), v(null)]);
    expect(ctx.temGrade).toBe(false);
    expect(faltantesEditaveis(SCHEMA, [], ctx).map((c) => c.id)).toContain('SIZE');
  });
  it('gênero null (legado) → GENDER continua editável', () => {
    const ctx = contextoFaltantes(null, [v('P'), v('M')]);
    expect(faltantesEditaveis(SCHEMA, [], ctx).map((c) => c.id)).toEqual(['BRAND', 'GENDER']);
  });
});
