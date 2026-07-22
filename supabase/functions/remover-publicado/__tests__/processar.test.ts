import { describe, it, expect } from 'vitest';
import { removerPublicado } from '../processar';

// Fake admin client: fila FIFO por tabela, consumida na ordem real das queries do
// processar.ts (maybeSingle/then). delete()/storage.remove() só gravam chamadas —
// nunca consomem a fila. Cobre só o que remover-publicado usa.
function fakeAdmin(filas: Record<string, unknown[]>) {
  const deletes: { tabela: string }[] = [];
  const removidos: string[][] = [];

  const proximo = (tabela: string) => {
    const fila = filas[tabela] ?? [];
    return fila.length ? fila.shift() : [];
  };

  function chain(tabela: string): any {
    const obj: any = {
      select: () => obj,
      eq: () => obj,
      not: () => obj,
      limit: () => obj,
      in: () => obj,
      maybeSingle: async () => ({ data: proximo(tabela) }),
      delete: () => {
        deletes.push({ tabela });
        const delObj: any = {
          eq: () => delObj,
          in: () => delObj,
          then: (resolve: any) => Promise.resolve({ data: null, error: null }).then(resolve),
        };
        return delObj;
      },
      then: (resolve: any) => Promise.resolve({ data: proximo(tabela), error: null }).then(resolve),
    };
    return obj;
  }

  const admin: any = {
    from: (tabela: string) => chain(tabela),
    storage: { from: () => ({ remove: async (paths: string[]) => { removidos.push(paths); return { error: null }; } }) },
  };
  return { admin, deletes, removidos };
}

const ORG = 'org-1';
const CANAL = 'mercado_livre';

describe('removerPublicado — família UP (guarda ADR-0088)', () => {
  it('família com itens em anuncios_externos_itens: recusa, nenhum delete roda', async () => {
    const { admin, deletes, removidos } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, // alvo (maybeSingle)
        [], // emVoo
      ],
      anuncios_externos: [[{ id: 'ext-1' }]], // raiz existe
      anuncios_externos_itens: [[{ id: 'item-1' }]], // e tem filho técnico UP
    });

    const r = await removerPublicado(admin, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });

    expect(r.tipo).toBe('bloqueio_up');
    expect(deletes).toEqual([]);
    expect(removidos).toEqual([]);
  });

  it('família sem anuncios_externos (nunca publicada por esse canal): não bloqueia por UP', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG },
        [],
        [{ id: 'fam-1', lote_id: 'lote-1', capa_storage_path: null, capa2_storage_path: null, capa3_storage_path: null, variacoes: [] }],
        [],
      ],
      anuncios_externos: [[]],
      lotes: [],
    });

    const r = await removerPublicado(admin, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });

    expect(r.tipo).toBe('ok');
    expect(deletes.map((d) => d.tabela)).toContain('familias');
  });
});

describe('removerPublicado — família Legacy (regressão: comportamento de hoje inalterado)', () => {
  it('raiz em anuncios_externos mas SEM linhas em anuncios_externos_itens: remove normalmente', async () => {
    const { admin, deletes, removidos } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '00012345', ml_item_id: 'MLB1', org_id: ORG }, // alvo
        [], // emVoo
        [{ // paraExcluir
          id: 'fam-1', lote_id: 'lote-1',
          capa_storage_path: 'capas/x.jpg', capa2_storage_path: null, capa3_storage_path: null,
          variacoes: [{ imagem_path: 'imgs/y.jpg' }],
        }],
        [], // rest do lote (recontarOuRemoverLote) → lote fica vazio
      ],
      anuncios_externos: [[{ id: 'ext-1' }]], // raiz existe (legacy também grava aqui)
      anuncios_externos_itens: [[]], // mas SEM filho técnico UP
      lotes: [],
    });

    const r = await removerPublicado(admin, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });

    expect(r.tipo).toBe('ok');
    if (r.tipo === 'ok') {
      expect(r.familiasRemovidas).toBe(1);
      expect(r.lotesRemovidos).toBe(1);
    }
    expect(deletes.map((d) => d.tabela)).toEqual(['familias', 'anuncios_externos', 'lotes']);
    expect(removidos).toEqual([['capas/x.jpg', 'imgs/y.jpg']]);
  });
});

describe('removerPublicado — casos já existentes (regressão)', () => {
  it('família não encontrada', async () => {
    const { admin } = fakeAdmin({ familias: [null] });
    const r = await removerPublicado(admin, { familiaId: 'x', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('nao_encontrada');
  });

  it('família sem ml_item_id → não publicada', async () => {
    const { admin } = fakeAdmin({ familias: [{ id: 'fam-1', codigo_pai: '000', ml_item_id: null, org_id: ORG }] });
    const r = await removerPublicado(admin, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('nao_publicada');
  });

  it('há família em publicando → em_voo', async () => {
    const { admin, deletes } = fakeAdmin({
      familias: [
        { id: 'fam-1', codigo_pai: '000', ml_item_id: 'MLB1', org_id: ORG },
        [{ id: 'fam-2' }], // emVoo não vazio
      ],
    });
    const r = await removerPublicado(admin, { familiaId: 'fam-1', orgId: ORG, canal: CANAL });
    expect(r.tipo).toBe('em_voo');
    expect(deletes).toEqual([]);
  });
});
