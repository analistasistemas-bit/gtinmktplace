import { describe, it, expect } from 'vitest';
import { particionarExclusao, filtrarPathsDeDonos, type FamiliaExclusao } from '../exclusao';

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
      donoUserId: 'u',
      familias: [fam('a', null, ['u/1.jpg']), fam('b', '2026-06-04T00:00:00Z', ['u/2.jpg'])],
      planilhaPath: 'u/l/plan.xlsx', imagensPaths: ['u/1.jpg', 'u/2.jpg', 'u/l/plan.xlsx'],
    });
    expect(r.paraExcluir.map((f) => f.id)).toEqual(['a']);
    expect(r.preservadas.map((f) => f.id)).toEqual(['b']);
    expect(r.loteVazio).toBe(false);
  });

  it('UPDATE que herdou ml_item_id mas nunca publicou (publicado_em null) é excluível', () => {
    const r = particionarExclusao({
      donoUserId: 'u',
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
      donoUserId: 'u',
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
      donoUserId: 'u',
      familias: [fam('a', null, ['u/1.jpg'])],
      planilhaPath: 'u/l/plan.xlsx', imagensPaths: ['u/1.jpg'],
    });
    expect(r.loteVazio).toBe(true);
    expect(r.pathsRemover).toEqual(expect.arrayContaining(['u/1.jpg', 'u/l/plan.xlsx']));
  });

  it('capa3 de publicada é preservada; capa3 de excluída entra em pathsRemover', () => {
    const r = particionarExclusao({
      donoUserId: 'u',
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
      donoUserId: 'u',
      familias: [fam('a', null, ['u/1.jpg', null, 'u/1.jpg'])],
      planilhaPath: null, imagensPaths: ['u/1.jpg'],
    });
    expect(r.pathsRemover.filter((p) => p === 'u/1.jpg')).toHaveLength(1);
  });

  // Guard de posse (F1): imagens_paths/planilha_path são colunas escritas pelo CLIENTE
  // (src/hooks/useUploadLote.ts) e capa_storage_path é editável por qualquer membro via RLS.
  // Sem o guard, um membro injeta o path de um colega num lote-isca próprio e o service_role
  // apaga o arquivo — inclusive de anúncio publicado — driblando a RLS de storage.
  it('descarta path cujo primeiro segmento não é o dono do lote', () => {
    const r = particionarExclusao({
      donoUserId: 'dono',
      familias: [fam('a', null, ['dono/1.jpg'])],
      planilhaPath: 'dono/l/plan.xlsx',
      imagensPaths: ['dono/1.jpg', 'vitima/capas/CAPA_00000042.jpg'],
    });
    expect(r.pathsRemover).toContain('dono/1.jpg');
    expect(r.pathsRemover).toContain('dono/l/plan.xlsx');
    expect(r.pathsRemover).not.toContain('vitima/capas/CAPA_00000042.jpg');
  });

  it('guard também cobre paths vindos das famílias, não só imagens_paths', () => {
    const r = particionarExclusao({
      donoUserId: 'dono',
      familias: [fam('a', null, ['vitima/2.jpg'], 'vitima/capa.jpg')],
      planilhaPath: null, imagensPaths: null,
    });
    expect(r.pathsRemover).toEqual([]);
  });
});

describe('filtrarPathsDeDonos', () => {
  it('mantém só paths cujo primeiro segmento está no conjunto de donos', () => {
    const donos = new Set(['user-a', 'user-b']);
    expect(filtrarPathsDeDonos(['user-a/x.jpg', 'user-b/y.jpg', 'outra-org/z.jpg'], donos))
      .toEqual(['user-a/x.jpg', 'user-b/y.jpg']);
  });

  it('descarta path sem barra, path vazio e path com primeiro segmento vazio', () => {
    const donos = new Set(['user-a']);
    expect(filtrarPathsDeDonos(['user-a', '', '/user-a/x.jpg', 'user-a/ok.jpg'], donos))
      .toEqual(['user-a/ok.jpg']);
  });

  it('não se deixa enganar por travessia que sobe do prefixo do dono', () => {
    const donos = new Set(['user-a']);
    expect(filtrarPathsDeDonos(['user-a/../vitima/x.jpg'], donos)).toEqual([]);
  });

  it('conjunto de donos vazio remove tudo (fail-closed)', () => {
    expect(filtrarPathsDeDonos(['user-a/x.jpg'], new Set())).toEqual([]);
  });
});
