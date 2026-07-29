import { describe, it, expect, beforeEach, vi } from 'vitest';

// ml/token.ts importa _shared/supabase.ts, que faz `import { createClient } from 'jsr:...'`
// (valor real, não elidido pelo bundler). Sob vitest isso quebra a resolução do módulo.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import { processarSincronizacao, type DepsSincronizacao } from '../processar';
import { fakeConnector } from '../../_shared/canais/fake';
import type { ChannelConnector } from '../../_shared/canais/contrato';

interface DB {
  familia: { id: string } | null;
  variacoes: Array<{ codigo: string; estoque: number }>;
  anuncios: Array<Record<string, unknown>>;
  itensUP: Array<Record<string, unknown>>;
}

/** Fake mínimo do SupabaseClient: só os padrões de query que processarSincronizacao usa. */
function fakeAdmin(db: DB) {
  function chain(tabela: string) {
    function ler(): { data: unknown; error: null } {
      if (tabela === 'familias') return { data: db.familia, error: null };
      if (tabela === 'variacoes') return { data: db.variacoes, error: null };
      if (tabela === 'anuncios_externos') return { data: db.anuncios, error: null };
      if (tabela === 'anuncios_externos_itens') return { data: db.itensUP, error: null };
      return { data: null, error: null };
    }
    // deno-lint-ignore no-explicit-any
    const api: any = {
      select: () => api,
      eq: () => api,
      in: () => api,
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ler(),
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve(ler()),
    };
    return api;
  }
  // deno-lint-ignore no-explicit-any
  return { from: (t: string) => chain(t) } as any;
}

/** Um conector que não é o ML — prova que o push é genuinamente cross-canal. */
const conectorFake = fakeConnector as unknown as ChannelConnector;

function deps(db: DB, over: Partial<DepsSincronizacao> = {}): DepsSincronizacao {
  return {
    admin: fakeAdmin(db),
    // Stub: devolve conexão para qualquer canal. O resolverConexao REAL devolveria null
    // para 'fake' (não existe linha em marketplace_connections) e o conector nunca
    // seria alcançado — é exatamente por isso que a dependência é injetável.
    resolverConexao: (async () => ({ id: 'conn-1' })) as unknown as DepsSincronizacao['resolverConexao'],
    getConnector: (() => conectorFake) as unknown as DepsSincronizacao['getConnector'],
    // Idem: getValidAccessTokenConexao é específico do ML.
    fabricarToken: () => () => Promise.resolve('token-fake'),
    ...over,
  };
}

function chamadasDeEstoque() {
  return fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarEstoque')
    .map((c) => c.args as { itemExternoId: string; estoques: Array<{ sku: string; estoque: number }> });
}

const JOB = { org_id: 'org-1', codigo_pai: 'P001', canal_origem: null as string | null };

describe('processarSincronizacao', () => {
  beforeEach(() => fakeConnector.reset());

  it('produto sem família: não empurra nada', async () => {
    const r = await processarSincronizacao(
      deps({ familia: null, variacoes: [], anuncios: [], itensUP: [] }), JOB,
    );
    expect(r.status).toBe(200);
    expect(chamadasDeEstoque()).toHaveLength(0);
  });

  it('empurra os valores ABSOLUTOS atuais para o anúncio', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }, { codigo: 'A2', estoque: 0 }],
      anuncios: [{ id: 'x', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {}, A2: {} } }],
      itensUP: [],
    };
    const r = await processarSincronizacao(deps(db), JOB);
    expect(r.status).toBe(200);
    expect(chamadasDeEstoque()).toEqual([
      { itemExternoId: 'FK1', estoques: [{ sku: 'A1', estoque: 5 }, { sku: 'A2', estoque: 0 }] },
    ]);
  });

  it('venda: o canal de ORIGEM não recebe push, os demais recebem', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 3 }],
      anuncios: [
        { id: 'x', canal: 'mercado_livre', item_externo_id: 'MLB1', variacoes_externas: { A1: {} } },
        { id: 'y', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } },
      ],
      itensUP: [],
    };
    const r = await processarSincronizacao(deps(db), { ...JOB, canal_origem: 'mercado_livre' });
    expect(r.status).toBe(200);
    expect(chamadasDeEstoque().map((c) => c.itemExternoId)).toEqual(['FK1']);
  });

  it('entrada (canal_origem null): TODOS os canais recebem push', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 3 }],
      anuncios: [
        { id: 'x', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } },
        { id: 'y', canal: 'fake', item_externo_id: 'FK2', variacoes_externas: { A1: {} } },
      ],
      itensUP: [],
    };
    await processarSincronizacao(deps(db), { ...JOB, canal_origem: null });
    expect(chamadasDeEstoque().map((c) => c.itemExternoId)).toEqual(['FK1', 'FK2']);
  });

  // Regressão do bloqueador achado na revisão: a linha-mãe de uma família user
  // products tem item_externo_id NULL, e os ids vivem nos filhos.
  it('user products: pai com item_externo_id NULL → push em cada item filho', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }, { codigo: 'A3', estoque: 7 }],
      anuncios: [{ id: 'p0', canal: 'fake', item_externo_id: null, variacoes_externas: { A1: {}, A3: {} } }],
      itensUP: [
        { anuncio_externo_id: 'p0', sku: 'A1', item_externo_id: 'FK-A1', retirado: false, status: 'ativo' },
        { anuncio_externo_id: 'p0', sku: 'A3', item_externo_id: 'FK-A3', retirado: false, status: 'ativo' },
      ],
    };
    await processarSincronizacao(deps(db), JOB);
    expect(chamadasDeEstoque()).toEqual([
      { itemExternoId: 'FK-A1', estoques: [{ sku: 'A1', estoque: 5 }] },
      { itemExternoId: 'FK-A3', estoques: [{ sku: 'A3', estoque: 7 }] },
    ]);
  });

  it('item UP em remoção não recebe push', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }],
      anuncios: [{ id: 'p0', canal: 'fake', item_externo_id: null, variacoes_externas: { A1: {} } }],
      itensUP: [
        { anuncio_externo_id: 'p0', sku: 'A1', item_externo_id: 'FK-A1', retirado: false, status: 'remocao_pendente' },
      ],
    };
    await processarSincronizacao(deps(db), JOB);
    expect(chamadasDeEstoque()).toHaveLength(0);
  });

  it('erro retentável no canal → 500 (QStash re-tenta; push absoluto é idempotente)', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }],
      anuncios: [{ id: 'x', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } }],
      itensUP: [],
    };
    fakeConnector.falharProximo('RATE_LIMIT', true);
    const r = await processarSincronizacao(deps(db), JOB);
    expect(r.status).toBe(500);
  });

  it('erro definitivo no canal → 200 (não adianta re-tentar)', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }],
      anuncios: [{ id: 'x', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } }],
      itensUP: [],
    };
    fakeConnector.falharProximo('ESTOQUE', false);
    const r = await processarSincronizacao(deps(db), JOB);
    expect(r.status).toBe(200);
  });

  it('exceção inesperada num alvo é tratada como retentável e não aborta os demais', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }],
      anuncios: [
        { id: 'x', canal: 'explode', item_externo_id: 'E1', variacoes_externas: { A1: {} } },
        { id: 'y', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } },
      ],
      itensUP: [],
    };
    const r = await processarSincronizacao(deps(db, {
      getConnector: ((canal: string) => {
        if (canal === 'explode') throw new Error('conector quebrado');
        return conectorFake;
      }) as unknown as DepsSincronizacao['getConnector'],
    }), JOB);
    expect(r.status).toBe(500);                       // o alvo que explodiu vira retentável
    expect(chamadasDeEstoque()).toHaveLength(1);      // o outro canal foi empurrado assim mesmo
  });

  it('canal sem fábrica de token é pulado, não quebra o worker', async () => {
    const db: DB = {
      familia: { id: 'f1' },
      variacoes: [{ codigo: 'A1', estoque: 5 }],
      anuncios: [{ id: 'x', canal: 'fake', item_externo_id: 'FK1', variacoes_externas: { A1: {} } }],
      itensUP: [],
    };
    const r = await processarSincronizacao(deps(db, { fabricarToken: () => null }), JOB);
    expect(r.status).toBe(200);
    expect(chamadasDeEstoque()).toHaveLength(0);
  });
});
