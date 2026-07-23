import { describe, it, expect, beforeEach, vi } from 'vitest';

// Cadeia de imports reais (token/queue/espelhar) puxa jsr/QStash — mockado para o vitest.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));
const { enfileirarSpy, espelharSpy } = vi.hoisted(() => ({ enfileirarSpy: vi.fn(), espelharSpy: vi.fn() }));
vi.mock('../../_shared/queue.ts', () => ({ enfileirarVinculacaoCatalogo: enfileirarSpy }));
vi.mock('../../_shared/anuncios/espelhar.ts', () => ({ espelharAnuncioExterno: espelharSpy }));

import { processarAtualizacaoFamilia, type ProcessarDeps } from '../processar';
import { fakeConnector } from '../../_shared/canais/fake';
import type { ResultadoAtualizarUP } from '../../_shared/user-products/atualizar-familia-up';

const FAMILIA_BASE = {
  id: 'fam-1', user_id: 'user-1', org_id: 'org-1', codigo_pai: '03103331', nome_pai: 'AGULHA',
  titulo_ml: 'AGULHA MATTE', descricao_ml: 'Desc', categoria_ml_id: 'MLB419782', atributos_ml: [],
  ml_item_id: 'MLB-EXISTENTE', ml_permalink: 'https://ml/x', status: 'publicando', atacado: null, atacado_status: null,
  fornecedor: null, capa_ml_picture_id: 'CAPA', capa2_ml_picture_id: null, capa2_storage_path: null,
  capa3_ml_picture_id: null, capa3_storage_path: null, variacao_principal_codigo: null,
  exibir_com_desconto: false, desconto_pct: null,
};
// Casada (ml_variation_id) → reposição pura Legacy: novas=[], sem CREATE de variação.
const VAR_CASADA = { codigo: 'V1', cor: 'Azul', estoque: 5, preco_publicacao: 29.9, gtin: null, imagem_path: null, ml_picture_id: 'PIC1', ml_variation_id: 'MLV1', altura_cm: 1, largura_cm: 1, comprimento_cm: 1, peso_gramas: 100 };

const CONEXAO_ROW = { id: 'conn-1', org_id: 'org-1', canal: 'mercado_livre', conta_externa_id: 'seller-1', expires_at: null };
const JOB = { familia_id: 'fam-1', lote_id: 'lote-1' };

function fakeAdmin(over: {
  familia?: Record<string, unknown> | null;
  variacoes?: Record<string, unknown>[];
  conexao?: Record<string, unknown> | null;
  raizUP?: Record<string, unknown> | null;
  itensUP?: Record<string, unknown>[];
  raizErr?: boolean;   // simula erro na query de roteamento (raiz UP)
  itensErr?: boolean;  // simula erro na query de roteamento (itens UP)
} = {}) {
  const writes: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const familia = over.familia === undefined ? { ...FAMILIA_BASE } : over.familia;
  const variacoes = over.variacoes ?? [{ ...VAR_CASADA }];
  const conexao = over.conexao === undefined ? CONEXAO_ROW : over.conexao;
  const raizUP = over.raizUP ?? null;
  const itensUP = over.itensUP ?? [];
  function chain(table: string) {
    const rec = { table, op: '', filters: {} as Record<string, unknown>, payload: {} as Record<string, unknown> };
    const ler = () => {
      if (table === 'familias') return familia;
      if (table === 'variacoes') return variacoes;
      if (table === 'marketplace_connections') return conexao;
      if (table === 'configuracoes') return { desconto_pct: 15 };
      if (table === 'anuncios_externos') return raizUP;
      if (table === 'anuncios_externos_itens') return itensUP;
      return null;
    };
    const api: Record<string, unknown> = {
      select: () => { rec.op = rec.op || 'select'; return api; },
      eq: (c: string, v: unknown) => { rec.filters[c] = v; return api; },
      in: () => api,
      is: () => api,
      limit: () => api,
      update: (payload: Record<string, unknown>) => { rec.op = 'update'; rec.payload = payload; return api; },
      single: async () => ({ data: ler(), error: null }),
      maybeSingle: async () => {
        if (table === 'anuncios_externos' && over.raizErr) return { data: null, error: { message: 'boom-raiz' } };
        return { data: ler(), error: null };
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (rec.op === 'update') writes.push({ table, payload: rec.payload, filters: rec.filters });
        if (table === 'anuncios_externos_itens' && over.itensErr) return Promise.resolve({ data: null, error: { message: 'boom-itens' } }).then(resolve);
        return Promise.resolve({ data: rec.op === 'update' ? null : ler(), error: null }).then(resolve);
      },
    };
    return api;
  }
  const storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'x' }, error: null }) }) };
  return { admin: { from: chain, storage } as never, writes };
}

function baseDeps(admin: never, extra: Partial<ProcessarDeps> = {}): ProcessarDeps {
  return { admin, conn: fakeConnector as never, finalizarLote: async () => {}, ...extra };
}

beforeEach(() => { fakeConnector.reset(); enfileirarSpy.mockReset(); espelharSpy.mockReset(); });

describe('processarAtualizacaoFamilia — roteamento UP vs Legacy', () => {
  it('família COM linhas em anuncios_externos_itens → caminho UP; Legacy (atualizarAnuncio) NUNCA chamado', async () => {
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'AGULHA MATTE', criado_em: '2026-07-22T00:00:00Z' }, itensUP: [{ id: 'it-1' }] });
    const upArgs: unknown[] = [];
    let finalizou = false;
    const deps = baseDeps(admin, {
      atualizarUP: async (a): Promise<ResultadoAtualizarUP> => { upArgs.push(a); return { estado: 'ok', adicionadas: 1 }; },
      finalizarLote: async () => { finalizou = true; },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(upArgs).toHaveLength(1);
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarAnuncio')).toHaveLength(0);
    expect(r).toEqual({ tipo: 'ok', itemExternoId: 'MLB-EXISTENTE', novas: 1 });
    expect(finalizou).toBe(true);
  });

  it('UP retry (mudança de composição incompleta) → tipo retry, NÃO finaliza lote nem marca erro', async () => {
    const { admin, writes } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T' }, itensUP: [{ id: 'it-1' }] });
    let finalizou = false;
    const deps = baseDeps(admin, {
      atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'retry', mensagem: 'retomando' }),
      finalizarLote: async () => { finalizou = true; },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'retry', mensagem: 'retomando' });
    expect(finalizou).toBe(false);
    expect(writes.find((w) => w.table === 'familias' && w.payload.status === 'erro')).toBeUndefined();
  });

  it('UP erro terminal → tipo erro, finaliza lote', async () => {
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T' }, itensUP: [{ id: 'it-1' }] });
    let finalizou = false;
    const deps = baseDeps(admin, {
      atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'erro', mensagem: 'desagrupada' }),
      finalizarLote: async () => { finalizou = true; },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'erro', mensagem: 'desagrupada' });
    expect(finalizou).toBe(true);
  });

  it('REGRESSÃO Legacy: SEM linhas filhas (raiz ausente) → atualizarUP NUNCA chamado, segue Legacy', async () => {
    const { admin, writes } = fakeAdmin({ raizUP: null, itensUP: [] });
    let upChamado = false;
    const deps = baseDeps(admin, { atualizarUP: async () => { upChamado = true; return { estado: 'ok', adicionadas: 0 }; } });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(upChamado).toBe(false);
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarAnuncio')).toHaveLength(1);
    expect(r.tipo).toBe('ok');
    expect(writes.find((w) => w.table === 'familias' && w.payload.status === 'publicado')).toBeDefined();
  });

  it('REGRESSÃO Legacy: raiz existe mas SEM itens filhos (item-plano-1-var ADR-0084) → Legacy intocado', async () => {
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T', criado_em: null }, itensUP: [] });
    let upChamado = false;
    const deps = baseDeps(admin, { atualizarUP: async () => { upChamado = true; return { estado: 'ok', adicionadas: 0 }; } });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(upChamado).toBe(false);
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarAnuncio')).toHaveLength(1);
    expect(r.tipo).toBe('ok');
  });

  // Fix 3 — erro na query de roteamento NÃO pode cair silencioso no Legacy (fail-closed).
  it('erro na query da raiz UP → NÃO executa UP nem Legacy (fail-closed, retenta)', async () => {
    const { admin } = fakeAdmin({ raizErr: true });
    let upChamado = false;
    const deps = baseDeps(admin, { atualizarUP: async () => { upChamado = true; return { estado: 'ok', adicionadas: 0 }; } });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(upChamado).toBe(false);
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarAnuncio')).toHaveLength(0);
    expect(r.tipo).toBe('retry');
  });

  it('erro na query de itens UP → NÃO executa UP nem Legacy (fail-closed, retenta)', async () => {
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T' }, itensErr: true });
    let upChamado = false;
    const deps = baseDeps(admin, { atualizarUP: async () => { upChamado = true; return { estado: 'ok', adicionadas: 0 }; } });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(upChamado).toBe(false);
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarAnuncio')).toHaveLength(0);
    expect(r.tipo).toBe('retry');
  });

  // Fix 4b — o orçamento de tentativas do worker chega até a mini-saga UP.
  it('tentativas é repassado a atualizarUP (orçamento de retry do incompleto)', async () => {
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T' }, itensUP: [{ id: 'it-1' }] });
    let tentativasVistas = -1;
    const deps = baseDeps(admin, {
      atualizarUP: async (a): Promise<ResultadoAtualizarUP> => { tentativasVistas = a.tentativas; return { estado: 'ok', adicionadas: 0 }; },
    });
    await processarAtualizacaoFamilia(deps, JOB, { tentativas: 7 });
    expect(tentativasVistas).toBe(7);
  });
});

describe('processarAtualizacaoFamilia — regressão Legacy (efeitos colaterais byte-a-byte)', () => {
  it('sucesso: publica, enfileira catálogo, espelha, retorna ok', async () => {
    const { admin, writes } = fakeAdmin();
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'ok', itemExternoId: 'MLB-EXISTENTE', novas: 0 });
    expect(writes.find((w) => w.table === 'familias' && w.payload.status === 'publicado')).toBeDefined();
    expect(enfileirarSpy).toHaveBeenCalledWith('fam-1');
    expect(espelharSpy).toHaveBeenCalledTimes(1);
  });

  it('erro definitivo do conector: marca família erro + limpa cache de foto das cores sem vínculo', async () => {
    const { admin, writes } = fakeAdmin();
    fakeConnector.falharProximo('FOTO', false); // esgotadas as tentativas → definitivo
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 10 });
    expect(r.tipo).toBe('erro');
    expect(writes.find((w) => w.table === 'familias' && w.payload.status === 'erro')).toBeDefined();
    // cleanup do catch: variacoes.ml_picture_id=null (cores ainda não vinculadas).
    expect(writes.find((w) => w.table === 'variacoes' && w.payload.ml_picture_id === null)).toBeDefined();
  });

  it('erro transitório com tentativas restantes → retry (mantém publicando, sem marcar erro)', async () => {
    const { admin, writes } = fakeAdmin();
    fakeConnector.falharProximo('FOTO', true); // retentável
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('retry');
    expect(writes.find((w) => w.table === 'familias' && w.payload.status === 'erro')).toBeUndefined();
  });
});

describe('processarAtualizacaoFamilia — guardas de entrada', () => {
  it('família inexistente → familia_inexistente', async () => {
    const { admin } = fakeAdmin({ familia: null });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'familia_inexistente' });
  });

  it('status != publicando → skip idempotente', async () => {
    const { admin } = fakeAdmin({ familia: { ...FAMILIA_BASE, status: 'publicado' } });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'skip', status: 'publicado' });
  });
});
