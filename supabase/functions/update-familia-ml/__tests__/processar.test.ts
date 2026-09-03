import { describe, it, expect, beforeEach, vi } from 'vitest';

// Cadeia de imports reais (token/queue/espelhar) puxa jsr/QStash — mockado para o vitest.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));
const { enfileirarSpy, espelharSpy, enfileirarFiscalSpy } = vi.hoisted(() => ({
  enfileirarSpy: vi.fn(), espelharSpy: vi.fn(), enfileirarFiscalSpy: vi.fn(async () => 'msg-1'),
}));
vi.mock('../../_shared/queue.ts', () => ({
  enfileirarVinculacaoCatalogo: enfileirarSpy, enfileirarSincronizacaoFiscal: enfileirarFiscalSpy,
}));
vi.mock('../../_shared/anuncios/espelhar.ts', () => ({ espelharAnuncioExterno: espelharSpy }));

const { notificarCategoriaSpy } = vi.hoisted(() => ({ notificarCategoriaSpy: vi.fn() }));
vi.mock('../../_shared/notificacoes/config.ts', () => ({ notificarCategoria: notificarCategoriaSpy }));

import { processarAtualizacaoFamilia, mensagemNotificacaoAddVariacao, type ProcessarDeps } from '../processar';
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
// Fiscal completo (satisfaz camposFiscaisFaltantes, regime simples) — só nos testes de enqueue
// fiscal via rota UP (fix round 1); as demais famílias ficam incompletas de propósito (módulo
// fiscal desligado nelas por padrão em fakeAdmin).
const FAMILIA_FISCAL_OK = {
  ...FAMILIA_BASE, ncm: '39269090', origem: 'nacional', origem_nfe: 0, cest: null, fci: null,
  ex_tipi: null, tributacao_icms: '102', tributacao_icms_regime: 'simples', unidade: 'UN',
};

function fakeAdmin(over: {
  familia?: Record<string, unknown> | null;
  variacoes?: Record<string, unknown>[];
  conexao?: Record<string, unknown> | null;
  raizUP?: Record<string, unknown> | null;
  itensUP?: Record<string, unknown>[];
  raizErr?: boolean;   // simula erro na query de roteamento (raiz UP)
  itensErr?: boolean;  // simula erro na query de roteamento (itens UP)
  lote?: Record<string, unknown> | null; // ADR-0129 D-11: lotes.select('origem')
  modulosHabilitados?: string[];
} = {}) {
  const writes: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const familia = over.familia === undefined ? { ...FAMILIA_BASE } : over.familia;
  const variacoes = over.variacoes ?? [{ ...VAR_CASADA }];
  const conexao = over.conexao === undefined ? CONEXAO_ROW : over.conexao;
  const raizUP = over.raizUP ?? null;
  const itensUP = over.itensUP ?? [];
  const lote = over.lote === undefined ? null : over.lote;
  const modulosHabilitados = over.modulosHabilitados ?? [];
  function chain(table: string) {
    const rec = { table, op: '', filters: {} as Record<string, unknown>, payload: {} as Record<string, unknown> };
    const ler = () => {
      if (table === 'familias') return familia;
      if (table === 'variacoes') return variacoes;
      if (table === 'marketplace_connections') return conexao;
      if (table === 'configuracoes') return { desconto_pct: 15 };
      if (table === 'organizations') return { modulos_habilitados: modulosHabilitados };
      if (table === 'empresa_fiscal') return { regime_tributario: 'simples' };
      if (table === 'anuncios_externos') return raizUP;
      if (table === 'anuncios_externos_itens') return itensUP;
      if (table === 'lotes') return lote;
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

beforeEach(() => {
  fakeConnector.reset(); enfileirarSpy.mockReset(); espelharSpy.mockReset();
  notificarCategoriaSpy.mockReset(); enfileirarFiscalSpy.mockClear();
});

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

  it('fix round 1: rota UP com módulo fiscal ativo e cadastro completo → enfileira o push fiscal', async () => {
    const { admin } = fakeAdmin({
      familia: FAMILIA_FISCAL_OK, modulosHabilitados: ['fiscal'],
      raizUP: { id: 'root-1', titulo: 'AGULHA MATTE', criado_em: '2026-07-22T00:00:00Z' }, itensUP: [{ id: 'it-1' }],
    });
    const deps = baseDeps(admin, { atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'ok', adicionadas: 0 }) });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarFiscalSpy).toHaveBeenCalledWith(JOB.familia_id);
  });

  it('fix round 1: rota UP sem módulo fiscal → NÃO enfileira o push fiscal', async () => {
    const { admin } = fakeAdmin({
      familia: FAMILIA_FISCAL_OK, modulosHabilitados: [],
      raizUP: { id: 'root-1', titulo: 'AGULHA MATTE', criado_em: '2026-07-22T00:00:00Z' }, itensUP: [{ id: 'it-1' }],
    });
    const deps = baseDeps(admin, { atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'ok', adicionadas: 0 }) });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarFiscalSpy).not.toHaveBeenCalled();
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

  it('fix round 2 (I6): Legacy com módulo fiscal ativo e cadastro completo → enfileira o push fiscal', async () => {
    const { admin } = fakeAdmin({ raizUP: null, itensUP: [], familia: FAMILIA_FISCAL_OK, modulosHabilitados: ['fiscal'] });
    const deps = baseDeps(admin, { atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'ok', adicionadas: 0 }) });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarFiscalSpy).toHaveBeenCalledWith(JOB.familia_id);
  });

  it('fix round 2 (I6): Legacy sem módulo fiscal → NÃO enfileira o push fiscal', async () => {
    const { admin } = fakeAdmin({ raizUP: null, itensUP: [], familia: FAMILIA_FISCAL_OK, modulosHabilitados: [] });
    const deps = baseDeps(admin, { atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'ok', adicionadas: 0 }) });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarFiscalSpy).not.toHaveBeenCalled();
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

// ── ADR-0104 — família que o Mercado Livre migrou para User Products SOZINHO ──────────────────
// Ela foi publicada como Legacy, então NÃO tem linhas em anuncios_externos_itens e o atalho de
// roteamento local não a enxerga. O conector detecta pelo GET ao vivo e devolve MIGRADO_PARA_UP;
// o worker adota os irmãos por SKU e entrega à saga UP no MESMO attempt.
const UP_OBSERVADO = { familyId: 'FAM-9', familyName: 'AGULHA MATTE', sellerId: 'seller-1' };

describe('processarAtualizacaoFamilia — família migrada pelo ML para UP (ADR-0104)', () => {
  it('MIGRADO_PARA_UP → adota as cores casadas e roteia para a saga UP, sem pedir nada ao operador', async () => {
    // raiz existe mas SEM filhos → o atalho local não dispara; após a adoção a re-query a encontra.
    const { admin } = fakeAdmin({
      raizUP: { id: 'root-1', titulo: 'AGULHA MATTE', criado_em: '2026-07-22T00:00:00Z' },
      itensUP: [],
      variacoes: [{ ...VAR_CASADA }, { ...VAR_CASADA, codigo: 'V2', ml_variation_id: 'MLV2' }],
    });
    fakeConnector.falharProximo('MIGRADO_PARA_UP', false, UP_OBSERVADO);
    const adocoes: unknown[] = [];
    const upArgs: unknown[] = [];
    const deps = baseDeps(admin, {
      adotarUP: async (_p, entrada) => {
        adocoes.push(entrada);
        return { tipo: 'adotada', filhos: [], familyId: 'FAM-9' };
      },
      atualizarUP: async (a): Promise<ResultadoAtualizarUP> => { upArgs.push(a); return { estado: 'ok', adicionadas: 0 }; },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });

    expect(r).toEqual({ tipo: 'ok', itemExternoId: 'MLB-EXISTENTE', novas: 0 });
    expect(adocoes).toHaveLength(1);
    // Adota só as cores JÁ PUBLICADAS (casadas) — uma cor nova ainda não existe no ML.
    expect(adocoes[0]).toMatchObject({
      skus: ['V1', 'V2'], sellerEsperado: 'seller-1',
      mlItemIdAtual: 'MLB-EXISTENTE', familyNameObservado: 'AGULHA MATTE',
    });
    expect(upArgs).toHaveLength(1);
  });

  it('adoção incompleta → erro 400 definitivo com a mensagem observada; saga UP nunca roda', async () => {
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'X', criado_em: null }, itensUP: [] });
    fakeConnector.falharProximo('MIGRADO_PARA_UP', false, UP_OBSERVADO);
    let rodouUP = false;
    const deps = baseDeps(admin, {
      adotarUP: async () => ({ tipo: 'incompleta', mensagem: 'só 1 de 9 cores foram localizadas' }),
      atualizarUP: async (): Promise<ResultadoAtualizarUP> => { rodouUP = true; return { estado: 'ok', adicionadas: 0 }; },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
    if (r.tipo !== 'erro') return;
    expect(r.mensagem).toContain('só 1 de 9 cores foram localizadas');
    expect(rodouUP).toBe(false);
  });

  it('MIGRADO_PARA_UP sem family_name → 400, nunca adivinha (adoção nem é tentada)', async () => {
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'X', criado_em: null }, itensUP: [] });
    fakeConnector.falharProximo('MIGRADO_PARA_UP', false, { ...UP_OBSERVADO, familyName: null });
    let tentouAdotar = false;
    const deps = baseDeps(admin, {
      adotarUP: async () => { tentouAdotar = true; return { tipo: 'incompleta', mensagem: 'x' }; },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
    expect(tentouAdotar).toBe(false);
  });

  it('erro de canal comum (não MIGRADO_PARA_UP) segue o caminho de erro de sempre', async () => {
    const { admin } = fakeAdmin();
    fakeConnector.falharProximo('ESTOQUE', false);
    let tentouAdotar = false;
    const deps = baseDeps(admin, {
      adotarUP: async () => { tentouAdotar = true; return { tipo: 'incompleta', mensagem: 'x' }; },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    // O desfecho (erro vs retry) é a política de retry pré-existente e não muda aqui; o que este
    // teste trava é que só MIGRADO_PARA_UP aciona a adoção.
    expect(r.tipo).not.toBe('ok');
    expect(tentouAdotar).toBe(false);
  });
});

// ADR-0105 — o ML DISSOLVEU a família: fechou o item Legacy e criou N itens novos, SEM SKU e sem
// nenhum ponteiro do velho para o novo. O conector sinaliza `dissolvido`; o worker descobre a
// família sucessora pelo título e casa cada SKU pela COR observada no item morto.
describe('processarAtualizacaoFamilia — família DISSOLVIDA pelo ML (ADR-0105)', () => {
  const DISSOLVIDO = {
    titulo: 'AGULHA MATTE',
    categoriaId: 'MLB419782',
    corPorSku: { V1: 'Azul ML', V2: 'Rosa ML' },
    motivoFallback: 'Anúncio closed no Mercado Livre. Estoque e preço não podem ser atualizados — republique o produto para voltar a vender.',
  };
  const UP_DISSOLVIDO = { familyId: null, familyName: null, sellerId: 'seller-1', dissolvido: DISSOLVIDO };
  const duasCasadas = [{ ...VAR_CASADA }, { ...VAR_CASADA, codigo: 'V2', ml_variation_id: 'MLV2' }];

  const achada = {
    tipo: 'achada' as const,
    familia: {
      familyId: 'FAM-NOVA',
      familyName: 'AGULHA MATTE',
      itemPorCor: new Map([['Azul ML', 'MLB-A'], ['Rosa ML', 'MLB-B']]),
      coresAmbiguas: [],
    },
  };

  it('descobre a família nova, casa SKU→COR→irmão e entrega à saga UP no mesmo attempt', async () => {
    const { admin } = fakeAdmin({
      raizUP: { id: 'root-1', titulo: 'AGULHA MATTE', criado_em: null },
      itensUP: [],
      variacoes: duasCasadas,
    });
    fakeConnector.falharProximo('MIGRADO_PARA_UP', false, UP_DISSOLVIDO);
    const criterios: unknown[] = [];
    const adocoes: unknown[] = [];
    let portasUsadas: { buscarPorSku(sku: string): Promise<unknown> } | null = null;
    let rodouUP = false;
    const deps = baseDeps(admin, {
      descobrirUP: async (_f, crit) => { criterios.push(crit); return achada; },
      adotarUP: async (p, entrada) => {
        portasUsadas = p as never;
        adocoes.push(entrada);
        return { tipo: 'adotada', filhos: [], familyId: 'FAM-NOVA' };
      },
      atualizarUP: async (): Promise<ResultadoAtualizarUP> => { rodouUP = true; return { estado: 'ok', adicionadas: 0 }; },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });

    expect(r.tipo).toBe('ok');
    expect(rodouUP).toBe(true);
    // A busca da família ancora no título e na categoria do item morto, excluindo o próprio morto.
    expect(criterios[0]).toMatchObject({
      sellerId: 'seller-1', titulo: 'AGULHA MATTE', categoriaId: 'MLB419782', itemMortoId: 'MLB-EXISTENTE',
    });
    // O family_name da raiz vem dos IRMÃOS (o item morto não tem nenhum para dar).
    expect(adocoes[0]).toMatchObject({
      skus: ['V1', 'V2'], sellerEsperado: 'seller-1',
      mlItemIdAtual: 'MLB-EXISTENTE', familyNameObservado: 'AGULHA MATTE',
    });
    // O casamento por cor resolve cada SKU para o irmão certo, sem nenhuma busca remota por SKU.
    expect(await portasUsadas!.buscarPorSku('V1')).toEqual({ tipo: 'um', itemExternoId: 'MLB-A' });
    expect(await portasUsadas!.buscarPorSku('V2')).toEqual({ tipo: 'um', itemExternoId: 'MLB-B' });
  });

  it('cor sem irmão correspondente → aquele SKU não resolve (a regra tudo-ou-nada aborta a adoção)', async () => {
    const { admin } = fakeAdmin({
      raizUP: { id: 'root-1', titulo: 'T', criado_em: null }, itensUP: [], variacoes: duasCasadas,
    });
    fakeConnector.falharProximo('MIGRADO_PARA_UP', false, UP_DISSOLVIDO);
    let portasUsadas: { buscarPorSku(sku: string): Promise<unknown> } | null = null;
    const deps = baseDeps(admin, {
      descobrirUP: async () => ({
        ...achada,
        familia: { ...achada.familia, itemPorCor: new Map([['Azul ML', 'MLB-A']]) },
      }),
      adotarUP: async (p) => { portasUsadas = p as never; return { tipo: 'incompleta', mensagem: '1 de 2 cores' }; },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(await portasUsadas!.buscarPorSku('V2')).toEqual({ tipo: 'nenhum' });
    expect(r.tipo).toBe('erro');
  });

  it('nenhuma família sucessora → lança a mensagem ORIGINAL do guard (anúncio de fato encerrado)', async () => {
    const { admin } = fakeAdmin({ raizUP: null, itensUP: [], variacoes: duasCasadas });
    fakeConnector.falharProximo('MIGRADO_PARA_UP', false, UP_DISSOLVIDO);
    let tentouAdotar = false;
    const deps = baseDeps(admin, {
      descobrirUP: async () => ({ tipo: 'nenhuma' }),
      adotarUP: async () => { tentouAdotar = true; return { tipo: 'incompleta', mensagem: 'x' }; },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
    if (r.tipo !== 'erro') return;
    expect(r.mensagem).toBe(DISSOLVIDO.motivoFallback);
    expect(tentouAdotar).toBe(false);
  });

  it('mais de uma família candidata → erro com os family_id observados, sem adotar nada', async () => {
    const { admin } = fakeAdmin({ raizUP: null, itensUP: [], variacoes: duasCasadas });
    fakeConnector.falharProximo('MIGRADO_PARA_UP', false, UP_DISSOLVIDO);
    let tentouAdotar = false;
    const deps = baseDeps(admin, {
      descobrirUP: async () => ({ tipo: 'ambigua', familyIds: ['FAM-1', 'FAM-2'] }),
      adotarUP: async () => { tentouAdotar = true; return { tipo: 'incompleta', mensagem: 'x' }; },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
    if (r.tipo !== 'erro') return;
    expect(r.mensagem).toContain('FAM-1, FAM-2');
    expect(tentouAdotar).toBe(false);
  });

  it('REGRESSÃO ADR-0104: MIGRADO_PARA_UP sem `dissolvido` continua adotando por SKU, sem descobrir nada', async () => {
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'X', criado_em: null }, itensUP: [] });
    fakeConnector.falharProximo('MIGRADO_PARA_UP', false, UP_OBSERVADO);
    let descobriu = false;
    const deps = baseDeps(admin, {
      descobrirUP: async () => { descobriu = true; return { tipo: 'nenhuma' }; },
      adotarUP: async () => ({ tipo: 'adotada', filhos: [], familyId: 'FAM-9' }),
      atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'ok', adicionadas: 0 }),
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(descobriu).toBe(false);
    expect(r.tipo).toBe('ok');
  });
});

// ── ADR-0129 D-11 — sino de notificação ao concluir/errar o UPDATE do lote "Adicionar variação" ──
describe('mensagemNotificacaoAddVariacao', () => {
  it('sucesso: menciona o nome do pai e o Mercado Livre', () => {
    expect(mensagemNotificacaoAddVariacao('sucesso', 'Sandália X'))
      .toBe('Variações adicionadas: "Sandália X" atualizado no Mercado Livre.');
  });

  it('erro: inclui a mensagem de erro observada', () => {
    expect(mensagemNotificacaoAddVariacao('erro', 'Sandália X', 'preço divergente'))
      .toContain('preço divergente');
  });
});

describe('preservarPublicadas derivado do lote (fluxo "Adicionar variação")', () => {
  // Derivado do LOTE de propósito: o "Reenviar" da Revisão reenfileira só {familia_id, lote_id},
  // então um flag no job se perderia no retry e a família ficaria presa no mesmo erro do ML.
  const argsDoUpdate = () =>
    fakeConnector.chamadas.find((c) => c.metodo === 'atualizarAnuncio')?.args as { preservarPublicadas?: boolean };

  it('lote origem=manual → conector recebe preservarPublicadas=true', async () => {
    const { admin } = fakeAdmin({ lote: { origem: 'manual' } });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(argsDoUpdate().preservarPublicadas).toBe(true);
  });

  it('lote de planilha (origem != manual) → preservarPublicadas=false, update normal', async () => {
    const { admin } = fakeAdmin({ lote: { origem: 'planilha' } });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(argsDoUpdate().preservarPublicadas).toBe(false);
  });
});

describe('processarAtualizacaoFamilia — sino gated (ADR-0129 D-11)', () => {
  it('lote origem=manual + família operacao=UPDATE + sucesso → dispara notificarCategoria', async () => {
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, operacao: 'UPDATE' },
      lote: { origem: 'manual' },
    });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(notificarCategoriaSpy).toHaveBeenCalledTimes(1);
    expect(notificarCategoriaSpy).toHaveBeenCalledWith(
      admin, 'org-1', 'integracao', 'Variações adicionadas: "AGULHA" atualizado no Mercado Livre.',
    );
  });

  it('lote origem=manual + família operacao=UPDATE + erro → notifica com a mensagem de erro', async () => {
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, operacao: 'UPDATE' },
      lote: { origem: 'manual' },
    });
    fakeConnector.falharProximo('FOTO', false); // definitivo
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 10 });
    expect(r.tipo).toBe('erro');
    expect(notificarCategoriaSpy).toHaveBeenCalledTimes(1);
    const [, , categoria, texto] = notificarCategoriaSpy.mock.calls[0];
    expect(categoria).toBe('integracao');
    expect(texto).toContain('falha ao atualizar "AGULHA"');
  });

  it('família operacao=CREATE → NÃO notifica (reposição/CREATE fora do gate)', async () => {
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, operacao: 'CREATE' },
      lote: { origem: 'manual' },
    });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(notificarCategoriaSpy).not.toHaveBeenCalled();
  });

  it('lote origem=planilha (reposição normal) → NÃO notifica mesmo com operacao=UPDATE', async () => {
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, operacao: 'UPDATE' },
      lote: { origem: 'planilha' },
    });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(notificarCategoriaSpy).not.toHaveBeenCalled();
  });

  it('sem operacao (regressão: famílias antigas do teste base) → NÃO notifica', async () => {
    const { admin } = fakeAdmin(); // FAMILIA_BASE sem `operacao`, sem `lote`
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(notificarCategoriaSpy).not.toHaveBeenCalled();
  });

  it('notificarCategoria falha → best-effort, não derruba o worker nem muda o resultado', async () => {
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, operacao: 'UPDATE' },
      lote: { origem: 'manual' },
    });
    notificarCategoriaSpy.mockRejectedValueOnce(new Error('telegram fora do ar'));
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'ok', itemExternoId: 'MLB-EXISTENTE', novas: 0 });
  });

  it('retry não dispara notificação (não é desfecho final)', async () => {
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, operacao: 'UPDATE' },
      lote: { origem: 'manual' },
    });
    fakeConnector.falharProximo('FOTO', true); // retentável
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('retry');
    expect(notificarCategoriaSpy).not.toHaveBeenCalled();
  });
});
