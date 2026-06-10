import { describe, it, expect } from 'vitest';
import { particionarExclusao, type FamiliaExclusao } from '../exclusao';

// O sinal de "preservar" é publicado_em (realmente publicada), não ml_item_id —
// reposição UPDATE herda ml_item_id sem publicar. ml_item_id acompanha por padrão
// (publicada tem ambos) mas pode ser sobrescrito p/ simular o caso herdado.
const fam = (
  id: string,
  publicadoEm: string | null,
  vars: (string | null)[],
  capa: string | null = null,
  capa2: string | null = null,
  mlItemId: string | null = publicadoEm ? 'MLB1' : null,
  capa3: string | null = null,
): FamiliaExclusao => ({
  id, ml_item_id: mlItemId, publicado_em: publicadoEm,
  capa_storage_path: capa, capa2_storage_path: capa2, capa3_storage_path: capa3,
  variacoes: vars.map((p) => ({ imagem_path: p })),
});

describe('particionarExclusao', () => {
  it('separa publicadas (preservadas) das não publicadas (paraExcluir)', () => {
    const r = particionarExclusao({
      familias: [fam('a', null, ['u/1.jpg']), fam('b', '2026-06-04T00:00:00Z', ['u/2.jpg'])],
      planilhaPath: 'u/l/plan.xlsx', imagensPaths: ['u/1.jpg', 'u/2.jpg', 'u/l/plan.xlsx'],
    });
    expect(r.paraExcluir.map((f) => f.id)).toEqual(['a']);
    expect(r.preservadas.map((f) => f.id)).toEqual(['b']);
    expect(r.loteVazio).toBe(false);
  });

  it('UPDATE que herdou ml_item_id mas nunca publicou (publicado_em null) é excluível', () => {
    const r = particionarExclusao({
      familias: [fam('a', null, ['u/1.jpg'], null, null, 'MLB1')], // ml_item_id herdado, publicado_em null
      planilhaPath: 'u/l/plan.xlsx', imagensPaths: ['u/1.jpg'],
    });
    expect(r.paraExcluir.map((f) => f.id)).toEqual(['a']);
    expect(r.preservadas).toEqual([]);
    expect(r.loteVazio).toBe(true);
    expect(r.pathsRemover).toEqual(expect.arrayContaining(['u/1.jpg', 'u/l/plan.xlsx']));
  });

  it('pathsRemover NÃO inclui arquivos referenciados por publicadas sobreviventes', () => {
    const r = particionarExclusao({
      familias: [fam('a', null, ['u/1.jpg']), fam('b', '2026-06-04T00:00:00Z', ['u/2.jpg'], 'u/capa-b.jpg')],
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

  it('capa3 de publicada é preservada; capa3 de excluída entra em pathsRemover', () => {
    const r = particionarExclusao({
      familias: [
        fam('a', null, ['u/1.jpg'], 'u/capa-a.jpg', 'u/capa2-a.jpg', null, 'u/capa3-a.jpg'),
        fam('b', '2026-06-04T00:00:00Z', ['u/2.jpg'], 'u/capa-b.jpg', 'u/capa2-b.jpg', 'MLB1', 'u/capa3-b.jpg'),
      ],
      planilhaPath: null, imagensPaths: ['u/1.jpg', 'u/2.jpg', 'u/capa3-a.jpg', 'u/capa3-b.jpg'],
    });
    expect(r.pathsRemover).toContain('u/capa3-a.jpg');
    expect(r.pathsRemover).not.toContain('u/capa3-b.jpg');
    expect(r.pathsPreservar).toContain('u/capa3-b.jpg');
  });

  it('dedup de paths e ignora nulos', () => {
    const r = particionarExclusao({
      familias: [fam('a', null, ['u/1.jpg', null, 'u/1.jpg'])],
      planilhaPath: null, imagensPaths: ['u/1.jpg'],
    });
    expect(r.pathsRemover.filter((p) => p === 'u/1.jpg')).toHaveLength(1);
  });
});
