import { describe, it, expect, beforeEach, vi } from 'vitest';

// Cadeia de imports reais (token/queue/espelhar) puxa jsr/QStash — mockado para o vitest.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));
vi.mock('../../_shared/queue.ts', () => ({ enfileirarVinculacaoCatalogo: async () => {} }));
vi.mock('../../_shared/anuncios/espelhar.ts', () => ({ espelharAnuncioExterno: async () => {} }));

import { processarFamiliaML, type ProcessarDeps } from '../processar';
import { fakeConnector } from '../../_shared/canais/fake';
import type { FormatoRepo, FormatoPublicacaoML } from '../../_shared/ml/formato-publicacao';
import type { ResultadoUP } from '../../_shared/user-products/publicar-familia-up';

// ── Fake admin: familias/variacoes/marketplace_connections (o caminho UP é injetado, não toca DB). ──
function fakeAdmin(over: { variacoes?: Record<string, unknown>[]; familia?: Record<string, unknown>; conexao?: Record<string, unknown> | null } = {}) {
  const writes: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const familia = over.familia ?? { ...FAMILIA_BASE };
  const variacoes = over.variacoes ?? [{ ...VAR_BASE }];
  const conexao = over.conexao === undefined ? { id: 'conn-1', org_id: 'org-1', canal: 'mercado_livre', conta_externa_id: 'seller-1', expires_at: null } : over.conexao;
  function chain(table: string) {
    const rec = { table, op: '', payload: {} as Record<string, unknown>, filters: {} as Record<string, unknown> };
    const ler = () => {
      if (table === 'familias') return familia;
      if (table === 'variacoes') return variacoes;
      if (table === 'marketplace_connections') return conexao;
      if (table === 'configuracoes') return { desconto_pct: 15 };
      if (table === 'lotes' || table === 'anuncios_externos') return null;
      return null;
    };
    const api: Record<string, unknown> = {
      select: () => { rec.op = rec.op || 'select'; return api; },
      eq: (col: string, val: unknown) => { rec.filters[col] = val; return api; },
      update: (payload: Record<string, unknown>) => { rec.op = 'update'; rec.payload = payload; return api; },
      single: async () => ({ data: ler(), error: null }),
      maybeSingle: async () => ({ data: ler(), error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (rec.op === 'update') writes.push({ table, payload: rec.payload, filters: rec.filters });
        return Promise.resolve({ data: rec.op === 'update' ? null : ler(), error: null }).then(resolve);
      },
    };
    return api;
  }
  return { admin: { from: chain, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'x' }, error: null }) }) } } as never, writes };
}

const FAMILIA_BASE = {
  id: 'fam-1', user_id: 'user-1', org_id: 'org-1', codigo_pai: '03103331', nome_pai: 'AGULHA',
  titulo_ml: 'AGULHA MATTE', descricao_ml: 'Desc', categoria_ml_id: 'MLB419782', atributos_ml: [],
  atributos_faltantes: [], tipo_aviamento: 'outro', ml_item_id: null, atacado: null,
  capa_storage_path: null, capa_ml_picture_id: 'CAPA', capa2_storage_path: null, capa2_ml_picture_id: null,
  capa3_storage_path: null, capa3_ml_picture_id: null, variacao_principal_codigo: null,
  exibir_com_desconto: false, desconto_pct: null,
};
const VAR_BASE = { id: 'v1', codigo: 'V1', cor: 'Azul', estoque: 5, preco_publicacao: 29.9, gtin: null, imagem_path: null, ml_picture_id: 'PIC1', altura_cm: 1, largura_cm: 1, comprimento_cm: 1, peso_gramas: 100 };
function multiCor() {
  return [
    { ...VAR_BASE, id: 'v1', codigo: 'V1', cor: 'Azul', ml_picture_id: 'PIC1' },
    { ...VAR_BASE, id: 'v2', codigo: 'V2', cor: 'Verde', ml_picture_id: 'PIC2' },
  ];
}
const JOB = { familia_id: 'fam-1', lote_id: 'lote-1' };

function fakeFormatoRepo(seed?: FormatoPublicacaoML): { repo: FormatoRepo; salvos: Array<{ formato: FormatoPublicacaoML }> } {
  let val = seed ?? null;
  const salvos: Array<{ formato: FormatoPublicacaoML }> = [];
  return {
    repo: { buscar: async () => val, salvar: async (_c, _cat, f) => { val = f; salvos.push({ formato: f }); } },
    salvos,
  };
}

function baseDeps(admin: never, extra: Partial<ProcessarDeps> = {}): ProcessarDeps {
  return {
    admin, conn: fakeConnector as never,
    formatoRepo: fakeFormatoRepo().repo,
    finalizarLote: async () => {},
    ...extra,
  };
}

describe('processarFamiliaML — roteamento CREATE + ADR-0088 (saga UP)', () => {
  beforeEach(() => fakeConnector.reset());

  it('REGRESSÃO 1 cor: CREATE via conn, publica, NÃO entra no ramo UP', async () => {
    const { admin, writes } = fakeAdmin();
    let upChamado = false;
    const deps = baseDeps(admin, { publicarUP: async () => { upChamado = true; return { estado: 'ativo', itemExternoId: 'X', permalink: null }; } });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(upChamado).toBe(false);
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'criarAnuncio')).toHaveLength(1);
    const famUpd = writes.find((w) => w.table === 'familias' && w.payload.status === 'publicado');
    expect(famUpd?.payload.ml_item_id).toBe('FAKE-V1');
  });

  it('multi-cor, cache desconhecido, ML rejeita variations (FORMATO_INCOMPATIVEL) → confirma cache + saga → publicado', async () => {
    const { admin } = fakeAdmin({ variacoes: multiCor() });
    fakeConnector.falharProximo('FORMATO_INCOMPATIVEL', false);
    const { repo, salvos } = fakeFormatoRepo();
    const upArgs: unknown[] = [];
    const deps = baseDeps(admin, {
      formatoRepo: repo,
      publicarUP: async (a): Promise<ResultadoUP> => { upArgs.push(a); return { estado: 'ativo', itemExternoId: 'MLB-AZUL', permalink: 'p' }; },
    });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'criarAnuncio')).toHaveLength(1); // tentou variations 1x
    expect(salvos.map((s) => s.formato)).toContain('user_products'); // cache confirmado
    expect(upArgs).toHaveLength(1); // saga disparada
    expect(r.tipo).toBe('ok');
    if (r.tipo === 'ok') expect(r.itemExternoId).toBe('MLB-AZUL');
  });

  it('multi-cor, cache já user_products → NUNCA chama criarAnuncio (0 POST variations), vai direto pra saga', async () => {
    const { admin } = fakeAdmin({ variacoes: multiCor() });
    const { repo } = fakeFormatoRepo('user_products');
    let upChamado = false;
    const deps = baseDeps(admin, { formatoRepo: repo, publicarUP: async () => { upChamado = true; return { estado: 'ativo', itemExternoId: 'MLB-AZUL', permalink: null }; } });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'criarAnuncio')).toHaveLength(0);
    expect(upChamado).toBe(true);
    expect(r.tipo).toBe('ok');
  });

  it('saga compensacao_pendente → NÃO publicado (erro de retomada, familia já marcada dentro do publicarUP)', async () => {
    const { admin, writes } = fakeAdmin({ variacoes: multiCor() });
    const { repo } = fakeFormatoRepo('user_products');
    const deps = baseDeps(admin, { formatoRepo: repo, publicarUP: async () => ({ estado: 'compensacao_pendente', mensagem: 'Publicação parcial: 3 de 9 cores ativas. Reenvie para concluir.' }) });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
    // processarFamiliaML NÃO marca publicado; nenhuma escrita familias.status='publicado' por ele
    expect(writes.some((w) => w.table === 'familias' && w.payload.status === 'publicado')).toBe(false);
  });

  it('saga erro/familia_up_desagrupada → tipo erro', async () => {
    const { admin } = fakeAdmin({ variacoes: multiCor() });
    const { repo } = fakeFormatoRepo('user_products');
    const deps = baseDeps(admin, { formatoRepo: repo, publicarUP: async () => ({ estado: 'erro', codigo: 'familia_up_desagrupada', mensagem: 'agrupou diferente' }) });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
  });

  it('multi-cor LEGACY (criarAnuncio ok) → segue o tail de sucesso normal, sem UP', async () => {
    const { admin, writes } = fakeAdmin({ variacoes: multiCor() });
    const { repo } = fakeFormatoRepo(); // desconhecido
    let upChamado = false;
    const deps = baseDeps(admin, { formatoRepo: repo, publicarUP: async () => { upChamado = true; return { estado: 'ativo', itemExternoId: 'X', permalink: null }; } });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(upChamado).toBe(false);
    expect(writes.some((w) => w.table === 'familias' && w.payload.status === 'publicado')).toBe(true);
  });
});
