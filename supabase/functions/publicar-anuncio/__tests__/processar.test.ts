import { describe, it, expect, beforeEach, vi } from 'vitest';

// ml/token.ts importa _shared/supabase.ts, que faz `import { createClient } from 'jsr:...'`
// (valor real, não elidido pelo bundler). Sob vitest isso quebra a resolução do módulo —
// mockar aqui evita que o import chain real seja carregado (ctx.getToken nunca é chamado
// pelo fakeConnector, então o mock nunca precisa fazer nada de fato).
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import { processarJob } from '../processar';
import { fakeConnector } from '../../_shared/canais/fake';
import { registrarConectorParaTeste } from '../../_shared/canais/registry';

registrarConectorParaTeste(fakeConnector);

interface DB {
  familia: Record<string, unknown>;
  anuncioExterno: { status: string; item_externo_id: string | null; erro_mensagem: string | null; variacoes_externas: Record<string, unknown> };
  conexao: Record<string, unknown> | null;
  variacoes: Array<Record<string, unknown>>;
}

// Fake mínimo do SupabaseClient: cobre exatamente os padrões de query usados por
// processarJob (familias/anuncios_externos/marketplace_connections/variacoes) + storage
// (signed URL, nunca de fato chamado nestes testes pois as fotos já vêm com picture_id).
function fakeAdmin(db: DB) {
  const writes: Array<{ tabela: string; payload: Record<string, unknown> }> = [];

  function chain(tabela: string) {
    let inFiltro: { valores: unknown[] } | null = null;
    let updatePayload: Record<string, unknown> | null = null;

    function ler(): { data: unknown; error: null } {
      if (tabela === 'familias') return { data: db.familia, error: null };
      if (tabela === 'variacoes') return { data: db.variacoes, error: null };
      if (tabela === 'marketplace_connections') return { data: db.conexao, error: null };
      if (tabela === 'anuncios_externos') return { data: db.anuncioExterno, error: null };
      return { data: null, error: null };
    }

    const api: any = {
      select: () => api,
      eq: () => api,
      in: (_col: string, valores: unknown[]) => { inFiltro = { valores }; return api; },
      update: (payload: Record<string, unknown>) => { updatePayload = payload; return api; },
      single: async () => ler(),
      maybeSingle: async () => ler(),
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
        let resultado: { data: unknown; error: null };
        if (tabela === 'anuncios_externos' && updatePayload) {
          if (inFiltro && !inFiltro.valores.includes(db.anuncioExterno.status)) {
            resultado = { data: [], error: null }; // claim não bateu a condição de status
          } else {
            Object.assign(db.anuncioExterno, updatePayload);
            writes.push({ tabela, payload: updatePayload });
            resultado = { data: [{ item_externo_id: db.anuncioExterno.item_externo_id }], error: null };
          }
        } else if (updatePayload) {
          writes.push({ tabela, payload: updatePayload });
          resultado = { data: null, error: null };
        } else {
          resultado = ler();
        }
        return Promise.resolve(resultado).then(resolve);
      },
    };
    return api;
  }

  return {
    from: chain,
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/x' }, error: null }) }) },
    writes,
  } as any;
}

const FAMILIA_BASE = {
  id: 'fam-1', org_id: 'org-1', codigo_pai: '00000001', user_id: 'user-1',
  titulo_ml: 'Produto Teste', descricao_ml: 'Descrição', categoria_ml_id: 'MLB1',
  atributos_ml: [], capa_storage_path: null, capa_ml_picture_id: 'CAPA-1',
  capa2_storage_path: null, capa2_ml_picture_id: null, capa3_storage_path: null, capa3_ml_picture_id: null,
  variacao_principal_codigo: null, exibir_com_desconto: false, desconto_pct: null,
};

const VARIACOES_BASE = [
  { id: 'v1', codigo: 'V1', cor: 'Azul', estoque: 5, preco_publicacao: 29.9, gtin: 'g1', imagem_path: null, ml_picture_id: 'PIC-1', altura_cm: 1, largura_cm: 1, comprimento_cm: 1, peso_gramas: 100 },
];

function dbBase(): DB {
  return {
    familia: { ...FAMILIA_BASE },
    // Roteador já claimou (pendente → publicando) antes de enfileirar; o worker verifica esse estado.
    anuncioExterno: { status: 'publicando', item_externo_id: null, erro_mensagem: null, variacoes_externas: {} },
    conexao: { id: 'conn-1', org_id: 'org-1', canal: 'fake', conta_externa_id: 'acc-1', expires_at: null },
    variacoes: VARIACOES_BASE.map((v) => ({ ...v })),
  };
}

const JOB = { familia_id: 'fam-1', lote_id: 'lote-1', canal: 'fake' };

describe('processarJob (publicar-anuncio)', () => {
  beforeEach(() => fakeConnector.reset());

  it('CREATE feliz: publica e persiste item_externo_id em anuncios_externos', async () => {
    const db = dbBase();
    const admin = fakeAdmin(db);
    const r = await processarJob({ admin }, JOB);

    expect(r.tipo).toBe('ok');
    if (r.tipo === 'ok') expect(r.itemExternoId).toMatch(/^FAKE-/);
    expect(db.anuncioExterno.status).toBe('publicado');
    expect(db.anuncioExterno.item_externo_id).toMatch(/^FAKE-/);
  });

  it('erro retentável: NÃO marca erro (linha segue publicando p/ o QStash retentar)', async () => {
    const db = dbBase();
    const admin = fakeAdmin(db);
    fakeConnector.falharProximo('RATE_LIMIT', true);

    const r = await processarJob({ admin }, JOB);

    expect(r.tipo).toBe('erro_retentavel');
    expect(db.anuncioExterno.status).toBe('publicando');
    expect(db.anuncioExterno.erro_mensagem).toBeNull();
  });

  it('erro definitivo: marca a linha como erro com a mensagem', async () => {
    const db = dbBase();
    const admin = fakeAdmin(db);
    fakeConnector.falharProximo('TITULO', false);

    const r = await processarJob({ admin }, JOB);

    expect(r.tipo).toBe('erro_definitivo');
    expect(db.anuncioExterno.status).toBe('erro');
    expect(db.anuncioExterno.erro_mensagem).toContain('fake:TITULO');
  });

  it('re-entrega: linha já publicado (sucesso anterior) → skip idempotente', async () => {
    const db = dbBase();
    db.anuncioExterno.status = 'publicado';
    db.anuncioExterno.item_externo_id = 'FAKE-V1';
    const admin = fakeAdmin(db);

    const r = await processarJob({ admin }, JOB);

    expect(r.tipo).toBe('skip');
    expect(db.anuncioExterno.status).toBe('publicado');
    expect(fakeConnector.chamadas).toHaveLength(0);
  });

  it('canal não conectado: marca erro definitivo sem chamar o conector', async () => {
    const db = dbBase();
    db.conexao = null;
    const admin = fakeAdmin(db);

    const r = await processarJob({ admin }, JOB);

    expect(r.tipo).toBe('erro_definitivo');
    expect(db.anuncioExterno.status).toBe('erro');
    expect(fakeConnector.chamadas).toHaveLength(0);
  });

  it('isolamento (D-E6.2): nenhuma escrita em familias.status em nenhum dos caminhos', async () => {
    for (const cenario of [
      () => {}, // CREATE feliz
      () => fakeConnector.falharProximo('RATE_LIMIT', true), // retentável
      () => fakeConnector.falharProximo('TITULO', false), // definitivo
    ]) {
      const db = dbBase();
      const admin = fakeAdmin(db);
      cenario();
      await processarJob({ admin }, JOB);
      const escritasFamilias = (admin.writes as Array<{ tabela: string; payload: Record<string, unknown> }>)
        .filter((w) => w.tabela === 'familias');
      expect(escritasFamilias.every((w) => !('status' in w.payload))).toBe(true);
    }
  });
});
