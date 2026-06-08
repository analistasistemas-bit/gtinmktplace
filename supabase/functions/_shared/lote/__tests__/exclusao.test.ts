import { describe, it, expect } from 'vitest';
import { particionarExclusao, type FamiliaExclusao } from '../exclusao';

const fam = (id: string, mlItemId: string | null, vars: (string | null)[], capa: string | null = null, capa2: string | null = null): FamiliaExclusao => ({
  id, ml_item_id: mlItemId,
  capa_storage_path: capa, capa2_storage_path: capa2,
  variacoes: vars.map((p) => ({ imagem_path: p })),
});

describe('particionarExclusao', () => {
  it('separa publicadas (preservadas) das não publicadas (paraExcluir)', () => {
    const r = particionarExclusao({
      familias: [fam('a', null, ['u/1.jpg']), fam('b', 'MLB1', ['u/2.jpg'])],
      planilhaPath: 'u/l/plan.xlsx', imagensPaths: ['u/1.jpg', 'u/2.jpg', 'u/l/plan.xlsx'],
    });
    expect(r.paraExcluir.map((f) => f.id)).toEqual(['a']);
    expect(r.preservadas.map((f) => f.id)).toEqual(['b']);
    expect(r.loteVazio).toBe(false);
  });

  it('pathsRemover NÃO inclui arquivos referenciados por publicadas sobreviventes', () => {
    const r = particionarExclusao({
      familias: [fam('a', null, ['u/1.jpg']), fam('b', 'MLB1', ['u/2.jpg'], 'u/capa-b.jpg')],
      planilhaPath: 'u/l/plan.xlsx', imagensPaths: ['u/1.jpg', 'u/2.jpg', 'u/capa-b.jpg'],
    });
    expect(r.pathsRemover).toContain('u/1.jpg');
    expect(r.pathsRemover).toContain('u/l/plan.xlsx');
    expect(r.pathsRemover).not.toContain('u/2.jpg');
    expect(r.pathsRemover).not.toContain('u/capa-b.jpg');
  });

  it('0 publicadas → loteVazio true e remove tudo (planilha + imagens)', () => {
    const r = particionarExclusao({
      familias: [fam('a', null, ['u/1.jpg'])],
      planilhaPath: 'u/l/plan.xlsx', imagensPaths: ['u/1.jpg'],
    });
    expect(r.loteVazio).toBe(true);
    expect(r.pathsRemover).toEqual(expect.arrayContaining(['u/1.jpg', 'u/l/plan.xlsx']));
  });

  it('dedup de paths e ignora nulos', () => {
    const r = particionarExclusao({
      familias: [fam('a', null, ['u/1.jpg', null, 'u/1.jpg'])],
      planilhaPath: null, imagensPaths: ['u/1.jpg'],
    });
    expect(r.pathsRemover.filter((p) => p === 'u/1.jpg')).toHaveLength(1);
  });
});
