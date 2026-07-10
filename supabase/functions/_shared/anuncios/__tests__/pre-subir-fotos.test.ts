import { describe, expect, it, beforeEach } from 'vitest';
import { preSubirFotosFamilia } from '../pre-subir-fotos';
import { fakeConnector } from '../../canais/fake';

// Mock do SupabaseClient admin: devolve a família e as variações configuradas e captura os UPDATEs
// de persistência de picture_id (para provar que só as fotos pendentes sobem e são persistidas).
function fakeAdmin(fam: Record<string, unknown> | null, vars: Array<Record<string, unknown>>) {
  const updates: Array<{ tabela: string; patch: Record<string, unknown>; id: string }> = [];
  const admin = {
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }),
      }),
    },
    from: (tabela: string) => {
      let capturaId = '';
      const chain: any = {
        select: () => chain,
        eq: (_col: string, val: string) => { capturaId = val; return chain; },
        maybeSingle: async () => ({ data: fam, error: null }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => { updates.push({ tabela, patch, id }); return { error: null }; },
        }),
        // a query de variações resolve como thenable (select().eq().eq())
        then: (resolve: any) => Promise.resolve({ data: vars, error: null }).then(resolve),
      };
      return chain;
    },
  } as any;
  return { admin, updates };
}

const CTX = { getToken: async () => 'token' };

describe('preSubirFotosFamilia', () => {
  beforeEach(() => fakeConnector.reset());

  it('sobe as fotos pendentes (path presente, picture_id nulo) e persiste o id', async () => {
    const fam = {
      capa_storage_path: 'capas/00001.jpg', capa_ml_picture_id: null,
      capa2_storage_path: null, capa2_ml_picture_id: null,
      capa3_storage_path: null, capa3_ml_picture_id: null,
    };
    const vars = [{ id: 'v1', imagem_path: 'v1.jpg', ml_picture_id: null }];
    const { admin, updates } = fakeAdmin(fam, vars);

    const subiu = await preSubirFotosFamilia(admin, fakeConnector, CTX, 'fam-1');

    expect(subiu).toBe(2); // capa + v1
    const uploads = fakeConnector.chamadas.filter((c) => c.metodo === 'subirFoto');
    expect(uploads).toHaveLength(2);
    // persistiu o picture_id na coluna certa de cada tabela
    expect(updates.find((u) => u.tabela === 'familias')?.patch).toHaveProperty('capa_ml_picture_id');
    expect(updates.find((u) => u.tabela === 'variacoes')?.patch).toHaveProperty('ml_picture_id', 'FAKE-FOTO-1');
  });

  it('reusa picture_id já persistido — não re-sobe (idempotente)', async () => {
    const fam = {
      capa_storage_path: 'capas/00001.jpg', capa_ml_picture_id: 'ML-CAPA-JA',
      capa2_storage_path: null, capa2_ml_picture_id: null,
      capa3_storage_path: null, capa3_ml_picture_id: null,
    };
    const vars = [{ id: 'v1', imagem_path: 'v1.jpg', ml_picture_id: 'ML-V1-JA' }];
    const { admin, updates } = fakeAdmin(fam, vars);

    const subiu = await preSubirFotosFamilia(admin, fakeConnector, CTX, 'fam-1');

    expect(subiu).toBe(0);
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'subirFoto')).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it('ignora foto ausente (sem path)', async () => {
    const fam = {
      capa_storage_path: null, capa_ml_picture_id: null,
      capa2_storage_path: null, capa2_ml_picture_id: null,
      capa3_storage_path: null, capa3_ml_picture_id: null,
    };
    const { admin } = fakeAdmin(fam, []);
    const subiu = await preSubirFotosFamilia(admin, fakeConnector, CTX, 'fam-1');
    expect(subiu).toBe(0);
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'subirFoto')).toHaveLength(0);
  });

  it('best-effort: erro ao subir uma foto não quebra as demais', async () => {
    const fam = {
      capa_storage_path: 'capas/00001.jpg', capa_ml_picture_id: null,
      capa2_storage_path: null, capa2_ml_picture_id: null,
      capa3_storage_path: null, capa3_ml_picture_id: null,
    };
    const vars = [{ id: 'v1', imagem_path: 'v1.jpg', ml_picture_id: null }];
    const { admin } = fakeAdmin(fam, vars);
    // conector que falha só na primeira chamada
    let n = 0;
    const connFlaky = {
      ...fakeConnector,
      subirFoto: async (_ctx: unknown, sourceUrl: string) => {
        if (n++ === 0) throw new Error('falha simulada');
        return `OK-${sourceUrl}`;
      },
    } as any;

    const subiu = await preSubirFotosFamilia(admin, connFlaky, CTX, 'fam-1');
    expect(subiu).toBe(1); // a segunda foto subiu apesar da primeira falhar
  });
});
