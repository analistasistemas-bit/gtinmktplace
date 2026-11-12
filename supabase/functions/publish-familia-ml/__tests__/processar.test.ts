import { describe, it, expect, beforeEach, vi } from 'vitest';

// Cadeia de imports reais (token/queue/espelhar) puxa jsr/QStash — mockado para o vitest.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));
vi.mock('../../_shared/queue.ts', () => ({
  enfileirarVinculacaoCatalogo: async () => {},
  enfileirarSincronizacaoFiscal: vi.fn(async () => 'msg-1'),
  enfileirarPublicacoes: vi.fn(async () => []),
}));
vi.mock('../../_shared/anuncios/espelhar.ts', () => ({ espelharAnuncioExterno: async () => {} }));
// ADR-0204: revalidação da galeria do kit vinculado no ML — espiã; o padrão aprova tudo.
const { revalidarSpy } = vi.hoisted(() => ({ revalidarSpy: vi.fn() }));
vi.mock('../../_shared/kit-variacao/galeria-leitura.ts', async (importOriginal) => ({
  ...(await importOriginal<object>()), revalidarGaleria: revalidarSpy,
}));

import { processarFamiliaML, type ProcessarDeps } from '../processar';
import { rebaixarGaleriaSeRecusada } from '../galeria-recusa';
import { fakeConnector } from '../../_shared/canais/fake';
import type { FormatoRepo, FormatoPublicacaoML } from '../../_shared/ml/formato-publicacao';
import type { ResultadoUP } from '../../_shared/user-products/publicar-familia-up';
import { enfileirarSincronizacaoFiscal, enfileirarPublicacoes } from '../../_shared/queue';

// ── Fake admin: familias/variacoes/marketplace_connections (o caminho UP é injetado, não toca DB). ──
function fakeAdmin(over: {
  variacoes?: Record<string, unknown>[]; familia?: Record<string, unknown>; conexao?: Record<string, unknown> | null;
  modulosHabilitados?: string[];
  // ADR-0151 D-2: kits pendentes que o claim de "encadear após CREATE da base" deveria reclamar.
  kitsReclamados?: Array<{ id: string; lote_id: string }>;
  /** GTIN da unidade-base que o kit multiplica (consulta `variacoes!inner(familias)`). */
  gtinBase?: string;
  reajusteAtivo?: string | null; // rpc reajuste_ativo_produto (spec reajuste C2)
  reajusteErro?: boolean;
  ncm?: 'vigente' | 'vencido' | 'inexistente' | 'erro'; // rpc ncm_consultar (ADR-0187)
  filhosUP?: Record<string, unknown>[]; // anuncios_externos_itens (família UP já publicada)
  filhosErro?: boolean;
  kitComponentes?: string[]; // ADR-0200: SKUs usados em kit com variação
} = {}) {
  const writes: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const familia = over.familia ?? { ...FAMILIA_BASE };
  const variacoes = over.variacoes ?? [{ ...VAR_BASE }];
  const conexao = over.conexao === undefined ? { id: 'conn-1', org_id: 'org-1', canal: 'mercado_livre', conta_externa_id: 'seller-1', expires_at: null } : over.conexao;
  const modulosHabilitados = over.modulosHabilitados ?? [];
  const kitsReclamados = over.kitsReclamados ?? [];
  function chain(table: string) {
    const rec = { table, op: '', payload: {} as Record<string, unknown>, filters: {} as Record<string, unknown> };
    const ler = () => {
      if (table === 'familias') return familia;
      if (table === 'variacoes') return variacoes;
      if (table === 'marketplace_connections') return conexao;
      if (table === 'organizations') return { modulos_habilitados: modulosHabilitados };
      if (table === 'empresa_fiscal') return { regime_tributario: 'simples' };
      if (table === 'lotes' || table === 'anuncios_externos') return null;
      return null;
    };
    const api: Record<string, unknown> = {
      select: () => { rec.op = rec.op || 'select'; return api; },
      eq: (col: string, val: unknown) => { rec.filters[col] = val; return api; },
      // ADR-0151: claim do encadeamento pós-CREATE usa .not()/.in()/.is() além de .eq() — só
      // registram o filtro (não alteram o resultado além do dispatch por tabela abaixo).
      not: (col: string, op: string, val: unknown) => { rec.filters[col] = { not: op, val }; return api; },
      in: (col: string, vals: unknown[]) => { rec.filters[col] = vals; return api; },
      is: (col: string, val: unknown) => { rec.filters[col] = val; return api; },
      update: (payload: Record<string, unknown>) => { rec.op = 'update'; rec.payload = payload; return api; },
      single: async () => ({ data: ler(), error: null }),
      maybeSingle: async () => ({ data: ler(), error: null }),
      // `aplicarEstoqueDerivado` (kit) e a busca do GTIN da base encadeiam order/limit.
      order: () => api,
      limit: () => api,
      then: (resolve: (v: unknown) => unknown) => {
        // GTIN da unidade-base (ADR-0151 D-5 revisada): select em `variacoes` com join na família
        // da base — distinguido das variações da própria família pelo filtro do join.
        if (table === 'variacoes' && 'familias.codigo_pai' in rec.filters) {
          const g = over.gtinBase ?? null;
          return Promise.resolve({ data: g ? [{ gtin: g }] : [], error: null }).then(resolve);
        }
        // Claim do encadeamento de kits: update em `familias` filtrado por `kit_base_codigo_pai`.
        if (table === 'familias' && rec.op === 'update' && 'kit_base_codigo_pai' in rec.filters) {
          return Promise.resolve({ data: kitsReclamados, error: null }).then(resolve);
        }
        if (table === 'anuncios_externos_itens') {
          return Promise.resolve(over.filhosErro ? { data: null, error: { message: 'boom' } } : { data: over.filhosUP ?? [], error: null }).then(resolve);
        }
        if (rec.op === 'update') writes.push({ table, payload: rec.payload, filters: rec.filters });
        return Promise.resolve({ data: rec.op === 'update' ? null : ler(), error: null }).then(resolve);
      },
    };
    return api;
  }
  const rpc = async (fn: string, args?: { p_codigos?: string[] }) => {
    // ADR-0200: participação de kit com variação (RPC agregada).
    if (fn === 'kit_skus_participantes') {
      return { data: (over.kitComponentes ?? []).filter((c) => (args?.p_codigos ?? []).includes(c)), error: null };
    }
    // ADR-0187: ncm_consultar (gate fiscal) — default vigente p/ todo código pedido.
    if (fn === 'ncm_consultar') {
      const ncm = over.ncm ?? 'vigente';
      if (ncm === 'erro') return { data: null, error: { message: 'fora do ar' } };
      return { data: ncm === 'inexistente' ? [] : (args?.p_codigos ?? []).map((codigo) => ({ codigo, vigente: ncm === 'vigente' })), error: null };
    }
    return fn === 'reajuste_ativo_produto' && over.reajusteErro
      ? { data: null, error: { message: 'timeout' } }
      : { data: fn === 'reajuste_ativo_produto' ? (over.reajusteAtivo ?? null) : null, error: null };
  };
  return { admin: { from: chain, rpc, storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'x' }, error: null }) }) } } as never, writes };
}

const FAMILIA_BASE = {
  id: 'fam-1', user_id: 'user-1', org_id: 'org-1', codigo_pai: '03103331', nome_pai: 'AGULHA',
  titulo_ml: 'AGULHA MATTE', descricao_ml: 'Desc', categoria_ml_id: 'MLB419782', atributos_ml: [],
  atributos_faltantes: [], tipo_aviamento: 'outro', ml_item_id: null, atacado: null,
  capa_storage_path: null, capa_ml_picture_id: 'CAPA', capa2_storage_path: null, capa2_ml_picture_id: null,
  capa3_storage_path: null, capa3_ml_picture_id: null, variacao_principal_codigo: null,
};
const VAR_BASE = { id: 'v1', codigo: 'V1', cor: 'Azul', estoque: 5, preco_publicacao: 29.9, gtin: null, imagem_path: null, ml_picture_id: 'PIC1', altura_cm: 1, largura_cm: 1, comprimento_cm: 1, peso_gramas: 100 };
function multiCor() {
  return [
    { ...VAR_BASE, id: 'v1', codigo: 'V1', cor: 'Azul', ml_picture_id: 'PIC1' },
    { ...VAR_BASE, id: 'v2', codigo: 'V2', cor: 'Verde', ml_picture_id: 'PIC2' },
  ];
}
const JOB = { familia_id: 'fam-1', lote_id: 'lote-1' };
// Fiscal completo (satisfaz camposFiscaisFaltantes, regime simples) — usado só nos testes de
// enqueue fiscal via rota UP (fix round 1); as demais famílias do arquivo ficam incompletas de
// propósito (módulo fiscal desligado nelas, ver fakeAdmin acima).
const FAMILIA_FISCAL_OK = {
  ...FAMILIA_BASE, ncm: '39269090', origem: 'nacional', origem_nfe: 0, cest: null, fci: null,
  ex_tipi: null, tributacao_icms: '102', tributacao_icms_regime: 'simples', unidade: 'UN',
};

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

  it('ADR-0151 D-2: CREATE bem-sucedido reclama kits pendentes da mesma base e os enfileira', async () => {
    vi.mocked(enfileirarPublicacoes).mockClear();
    const { admin } = fakeAdmin({
      kitsReclamados: [{ id: 'kit-fam-1', lote_id: 'kit-lote-1' }, { id: 'kit-fam-2', lote_id: 'kit-lote-2' }],
    });
    const r = await processarFamiliaML(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarPublicacoes).toHaveBeenCalledWith(
      [
        { job: { familia_id: 'kit-fam-1', lote_id: 'kit-lote-1' }, alvo: 'publish' },
        { job: { familia_id: 'kit-fam-2', lote_id: 'kit-lote-2' }, alvo: 'publish' },
      ],
      'user-1',
    );
  });

  // ADR-0151 D-5 (revisada): o kit vai ao canal SEM GTIN, mas carrega o código da unidade-base
  // como fallback — o conector só o usa se o ML recusar por GTIN obrigatório (dry-run
  // /items/validate 2026-09-03: em alimentos nenhum EMPTY_GTIN_REASON substitui o GTIN).
  it('família kit: anúncio leva gtinPackFallback com o GTIN da unidade-base', async () => {
    fakeConnector.reset();
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, kit_base_codigo_pai: '00000082', kit_multiplicador: 2 },
      gtinBase: '7891000444764',
    });
    const r = await processarFamiliaML(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    const criar = fakeConnector.chamadas.find((c) => c.metodo === 'criarAnuncio');
    expect((criar?.args as { gtinPackFallback?: string }).gtinPackFallback).toBe('7891000444764');
    // O GTIN NÃO entra na variação: o payload padrão do kit continua sem código.
    expect((criar?.args as { variacoes: Array<{ gtin: string | null }> }).variacoes[0].gtin).toBeNull();
  });

  it('família comum (não-kit): nenhum gtinPackFallback no anúncio', async () => {
    fakeConnector.reset();
    const { admin } = fakeAdmin({ gtinBase: '7891000444764' });
    const r = await processarFamiliaML(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    const criar = fakeConnector.chamadas.find((c) => c.metodo === 'criarAnuncio');
    expect((criar?.args as { gtinPackFallback?: string }).gtinPackFallback).toBeUndefined();
  });

  it('kit cuja base não tem GTIN → fallback null (publica sem código, como antes)', async () => {
    fakeConnector.reset();
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, kit_base_codigo_pai: '00000082', kit_multiplicador: 2 },
    });
    const r = await processarFamiliaML(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    const criar = fakeConnector.chamadas.find((c) => c.metodo === 'criarAnuncio');
    expect((criar?.args as { gtinPackFallback?: string | null }).gtinPackFallback).toBeNull();
  });

  it('sem kits pendentes da base → NÃO chama enfileirarPublicacoes (caminho quente intocado)', async () => {
    vi.mocked(enfileirarPublicacoes).mockClear();
    const { admin } = fakeAdmin();
    const r = await processarFamiliaML(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarPublicacoes).not.toHaveBeenCalled();
  });

  it('fix round 2 (I6): Legacy com módulo fiscal ativo e cadastro completo → enfileira o push fiscal', async () => {
    vi.mocked(enfileirarSincronizacaoFiscal).mockClear();
    const { admin } = fakeAdmin({ familia: FAMILIA_FISCAL_OK, modulosHabilitados: ['fiscal'] });
    const deps = baseDeps(admin);
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarSincronizacaoFiscal).toHaveBeenCalledWith(JOB.familia_id);
  });

  it('fix round 2 (I6): Legacy sem módulo fiscal → NÃO enfileira o push fiscal', async () => {
    vi.mocked(enfileirarSincronizacaoFiscal).mockClear();
    const { admin } = fakeAdmin({ familia: FAMILIA_FISCAL_OK, modulosHabilitados: [] });
    const deps = baseDeps(admin);
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarSincronizacaoFiscal).not.toHaveBeenCalled();
  });

  // ADR-0195: sem isto `decidirSplit` nunca veria `legacy` e a divisão por soma não dispararia.
  it('CREATE multi-cor aceito com variations prova formato legacy', async () => {
    const { admin } = fakeAdmin({ variacoes: multiCor() });
    const { repo, salvos } = fakeFormatoRepo();
    const r = await processarFamiliaML(baseDeps(admin, { formatoRepo: repo }), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(salvos).toEqual([{ formato: 'legacy' }]);
  });

  it('CREATE de 1 cor não prova formato', async () => {
    const { admin } = fakeAdmin();
    const { repo, salvos } = fakeFormatoRepo();
    await processarFamiliaML(baseDeps(admin, { formatoRepo: repo }), JOB, { tentativas: 0 });
    expect(salvos).toEqual([]);
  });

  it('falha ao gravar o formato não derruba a publicação', async () => {
    const { admin } = fakeAdmin({ variacoes: multiCor() });
    const repo = { buscar: async () => null, salvar: async () => { throw new Error('boom'); } };
    const r = await processarFamiliaML(baseDeps(admin, { formatoRepo: repo }), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
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

  // ADR-0167: o Spike 051 provou que categorias de roupa/calçado SEMPRE recusam Legacy
  // (variations[]), até com 1 SKU só — e o retry reativo de 1 cor (ADR-0087) não sabe resolver
  // o guia de tamanhos (isso só acontece dentro da saga UP). Uma família com tamanho tem que ir
  // direto pra saga, mesmo com 1 SKU (onde `variacoes.length > 1` sozinho não bastaria).
  it('1 SKU COM tamanho → vai direto pra saga UP, NUNCA tenta criarAnuncio (ADR-0167)', async () => {
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, genero: 'masculino', categoria_ml_id: 'MLB108803' },
      variacoes: [{ ...VAR_BASE, tamanho: 'P' }],
    });
    let upChamado = false;
    const deps = baseDeps(admin, { publicarUP: async () => { upChamado = true; return { estado: 'ativo', itemExternoId: 'MLB-P', permalink: null }; } });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'criarAnuncio')).toHaveLength(0);
    expect(upChamado).toBe(true);
    expect(r.tipo).toBe('ok');
  });

  it('1 SKU sem tamanho continua na REGRESSÃO 1 cor (INV-1) — trava contra alargar demais o gate', async () => {
    const { admin } = fakeAdmin();
    let upChamado = false;
    const deps = baseDeps(admin, { publicarUP: async () => { upChamado = true; return { estado: 'ativo', itemExternoId: 'X', permalink: null }; } });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(upChamado).toBe(false);
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'criarAnuncio')).toHaveLength(1);
    expect(r.tipo).toBe('ok');
  });

  // ADR-0200 (Task 5, crítico 3): o desvio de item plano criaria o participante com available_quantity
  // fora da saga e da exclusão. Recusa antes do POST.
  it('1 SKU sem tamanho participante de kit com variação: recusa antes do POST', async () => {
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, organizations: { modulos_habilitados: ['kit_variacao'] } }, kitComponentes: ['V1'],
    });
    const deps = baseDeps(admin, { publicarUP: async () => { throw new Error('não deveria ir à saga'); } });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 }).catch((e: Error) => ({ tipo: 'lancou', mensagem: e.message }));
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'criarAnuncio')).toHaveLength(0);
    expect(JSON.stringify(r)).toMatch(/kit com variação/);
  });

  it('repassa a versão da política capturada no enfileiramento à saga UP', async () => {
    const { admin } = fakeAdmin({ variacoes: multiCor() });
    const { repo } = fakeFormatoRepo('user_products');
    let visto: unknown;
    const deps = baseDeps(admin, { formatoRepo: repo, publicarUP: async (a) => { visto = a.versoesKit; return { estado: 'ativo', itemExternoId: 'X', permalink: null }; } });
    await processarFamiliaML(deps, { ...JOB, versoes_kit: { V1: 3 } }, { tentativas: 0 });
    expect(visto).toEqual({ V1: 3 });
  });

  it('mesmo SKU em org sem o módulo: publica como hoje', async () => {
    const { admin } = fakeAdmin({ kitComponentes: ['V1'] });
    const r = await processarFamiliaML(baseDeps(admin), JOB, { tentativas: 0 });
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'criarAnuncio')).toHaveLength(1);
    expect(r.tipo).toBe('ok');
  });

  it('fix round 1: rota UP com módulo fiscal ativo e cadastro completo → enfileira o push fiscal', async () => {
    vi.mocked(enfileirarSincronizacaoFiscal).mockClear();
    const { admin } = fakeAdmin({ variacoes: multiCor(), familia: FAMILIA_FISCAL_OK, modulosHabilitados: ['fiscal'] });
    const { repo } = fakeFormatoRepo('user_products');
    const deps = baseDeps(admin, { formatoRepo: repo, publicarUP: async () => ({ estado: 'ativo', itemExternoId: 'MLB-AZUL', permalink: null }) });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarSincronizacaoFiscal).toHaveBeenCalledWith(JOB.familia_id);
  });

  it('fix round 1: rota UP sem módulo fiscal → NÃO enfileira o push fiscal', async () => {
    vi.mocked(enfileirarSincronizacaoFiscal).mockClear();
    const { admin } = fakeAdmin({ variacoes: multiCor(), familia: FAMILIA_FISCAL_OK, modulosHabilitados: [] });
    const { repo } = fakeFormatoRepo('user_products');
    const deps = baseDeps(admin, { formatoRepo: repo, publicarUP: async () => ({ estado: 'ativo', itemExternoId: 'MLB-AZUL', permalink: null }) });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarSincronizacaoFiscal).not.toHaveBeenCalled();
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

  it('saga UP com Picture id does not exist → limpa caches de foto', async () => {
    const { admin, writes } = fakeAdmin({
      variacoes: multiCor(),
      familia: { ...FAMILIA_BASE, capa2_ml_picture_id: 'CAPA2-MORTA' },
    });
    const { repo } = fakeFormatoRepo('user_products');
    const r = await processarFamiliaML(baseDeps(admin, {
      formatoRepo: repo,
      publicarUP: async () => ({
        estado: 'erro',
        mensagem: 'Problema nas fotos do anúncio (Picture id 939880-MLB111925046462_062026 does not exist.). Verifique as imagens das variações.',
      }),
      finalizarLote: async () => {},
    }), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
    expect(writes).toContainEqual(expect.objectContaining({
      table: 'variacoes',
      payload: { ml_picture_id: null },
    }));
    expect(writes).toContainEqual(expect.objectContaining({
      table: 'familias',
      payload: {
        capa_ml_picture_id: null,
        capa2_ml_picture_id: null,
        capa3_ml_picture_id: null,
      },
    }));
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

  const MSG_FOTO_MORTA =
    'Problema nas fotos do anúncio (Picture id 939880-MLB111925046462_062026 does not exist.). Verifique as imagens das variações.';

  function connErroFotoDefinitivo(mensagem = MSG_FOTO_MORTA, retentavel = false) {
    return {
      ...fakeConnector,
      criarAnuncio: async (_ctx: unknown, anuncio: unknown) => {
        fakeConnector.chamadas.push({ metodo: 'criarAnuncio', args: anuncio });
        return {
          ok: false,
          erro: { codigo: 'FOTO' as const, mensagemOperador: mensagem, retentavel },
        };
      },
    } as never;
  }

  it('erro definitivo de foto (Picture id does not exist) → limpa caches ml_picture_id e capas', async () => {
    const { admin, writes } = fakeAdmin({
      familia: { ...FAMILIA_BASE, capa2_ml_picture_id: 'CAPA2-MORTA' },
      variacoes: [{ ...VAR_BASE, ml_picture_id: 'PIC1' }],
    });
    const r = await processarFamiliaML(baseDeps(admin, {
      conn: connErroFotoDefinitivo(),
      finalizarLote: async () => {},
    }), JOB, { tentativas: 3 });

    expect(r.tipo).toBe('erro');
    expect(writes).toContainEqual(expect.objectContaining({
      table: 'variacoes',
      payload: { ml_picture_id: null },
      filters: expect.objectContaining({ familia_id: 'fam-1' }),
    }));
    expect(writes).toContainEqual(expect.objectContaining({
      table: 'familias',
      payload: {
        capa_ml_picture_id: null,
        capa2_ml_picture_id: null,
        capa3_ml_picture_id: null,
      },
    }));
  });

  it('foto retentável (item.pictures.unavailable) → NÃO limpa picture ids', async () => {
    const { admin, writes } = fakeAdmin({
      familia: { ...FAMILIA_BASE, capa2_ml_picture_id: 'CAPA2' },
      variacoes: [{ ...VAR_BASE, ml_picture_id: 'PIC1' }],
    });
    const r = await processarFamiliaML(baseDeps(admin, {
      conn: connErroFotoDefinitivo('item.pictures.unavailable', true),
    }), JOB, { tentativas: 0 });

    expect(r).toEqual({ tipo: 'retry', mensagem: 'item.pictures.unavailable' });
    expect(writes.filter((w) => w.payload.ml_picture_id === null)).toHaveLength(0);
    expect(writes.filter((w) => w.payload.capa_ml_picture_id === null)).toHaveLength(0);
  });

  it('item.pictures.unavailable com retries esgotados (codigo FOTO) → limpa cache mesmo sem "does not exist" na mensagem', async () => {
    const { admin, writes } = fakeAdmin({
      familia: { ...FAMILIA_BASE, capa2_ml_picture_id: 'CAPA2-MORTA' },
      variacoes: [{ ...VAR_BASE, ml_picture_id: 'PIC1' }],
    });
    const r = await processarFamiliaML(baseDeps(admin, {
      conn: connErroFotoDefinitivo('item.pictures.unavailable', true),
      finalizarLote: async () => {},
    }), JOB, { tentativas: 10 });

    expect(r.tipo).toBe('erro');
    expect(writes).toContainEqual(expect.objectContaining({
      table: 'variacoes',
      payload: { ml_picture_id: null },
    }));
    expect(writes).toContainEqual(expect.objectContaining({
      table: 'familias',
      payload: { capa_ml_picture_id: null, capa2_ml_picture_id: null, capa3_ml_picture_id: null },
    }));
  });

  it('regressão real de produção: does not exist com codigo DESCONHECIDO (classificarErroCanal não emite FOTO aqui) → ainda limpa cache pelo texto', async () => {
    const { admin, writes } = fakeAdmin({
      familia: { ...FAMILIA_BASE, capa2_ml_picture_id: 'CAPA2-MORTA' },
      variacoes: [{ ...VAR_BASE, ml_picture_id: 'PIC1' }],
    });
    const connDesconhecido = {
      ...fakeConnector,
      criarAnuncio: async (_ctx: unknown, anuncio: unknown) => {
        fakeConnector.chamadas.push({ metodo: 'criarAnuncio', args: anuncio });
        return { ok: false, erro: { codigo: 'DESCONHECIDO' as const, mensagemOperador: MSG_FOTO_MORTA, retentavel: false } };
      },
    } as never;
    const r = await processarFamiliaML(baseDeps(admin, {
      conn: connDesconhecido,
      finalizarLote: async () => {},
    }), JOB, { tentativas: 3 });

    expect(r.tipo).toBe('erro');
    expect(writes).toContainEqual(expect.objectContaining({
      table: 'variacoes',
      payload: { ml_picture_id: null },
    }));
  });

  function connLancaErro(mensagem: string, retentavel: boolean) {
    return {
      ...fakeConnector,
      criarAnuncio: async () => {
        const e = new Error(mensagem) as Error & { retentavel?: boolean };
        e.retentavel = retentavel;
        throw e;
      },
    } as never;
  }

  it('catch geral: exceção retentável com retries esgotados → limpa cache (cobre subirFoto/montarAnuncioCanonico falhando)', async () => {
    const { admin, writes } = fakeAdmin({
      familia: { ...FAMILIA_BASE, capa2_ml_picture_id: 'CAPA2-MORTA' },
      variacoes: [{ ...VAR_BASE, ml_picture_id: 'PIC1' }],
    });
    const r = await processarFamiliaML(baseDeps(admin, {
      conn: connLancaErro('item.pictures.unavailable', true),
      finalizarLote: async () => {},
    }), JOB, { tentativas: 10 });

    expect(r.tipo).toBe('erro');
    expect(writes).toContainEqual(expect.objectContaining({
      table: 'variacoes',
      payload: { ml_picture_id: null },
    }));
    expect(writes).toContainEqual(expect.objectContaining({
      table: 'familias',
      payload: { capa_ml_picture_id: null, capa2_ml_picture_id: null, capa3_ml_picture_id: null },
    }));
  });

  it('catch geral: exceção retentável AINDA dentro da janela de retry → NÃO limpa cache (guarda ADR-0033)', async () => {
    const { admin, writes } = fakeAdmin({
      familia: { ...FAMILIA_BASE, capa2_ml_picture_id: 'CAPA2' },
      variacoes: [{ ...VAR_BASE, ml_picture_id: 'PIC1' }],
    });
    const r = await processarFamiliaML(baseDeps(admin, {
      conn: connLancaErro('item.pictures.unavailable', true),
    }), JOB, { tentativas: 9 });

    expect(r).toEqual({ tipo: 'retry', mensagem: 'item.pictures.unavailable' });
    expect(writes.filter((w) => w.payload.ml_picture_id === null)).toHaveLength(0);
    expect(writes.filter((w) => w.payload.capa_ml_picture_id === null)).toHaveLength(0);
  });
});

describe('processarFamiliaML — barreira do reajuste de preço em massa (spec C2)', () => {
  beforeEach(() => fakeConnector.reset());

  it('reajuste ativo → erro definitivo 400, sem criar anúncio', async () => {
    const { admin, writes } = fakeAdmin({ reajusteAtivo: 'MLB1' });
    const r = await processarFamiliaML(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'erro', mensagem: 'Há reajuste de preço em massa em andamento neste produto (400)' });
    expect(fakeConnector.chamadas).toHaveLength(0);
    expect(writes.find((w) => w.table === 'familias' && w.payload.status === 'erro')?.payload.erro_mensagem)
      .toBe('Há reajuste de preço em massa em andamento neste produto (400)');
  });

  it('RPC falha → retry (fail-closed), sem criar anúncio', async () => {
    const { admin } = fakeAdmin({ reajusteErro: true });
    const r = await processarFamiliaML(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'retry', mensagem: 'Falha ao conferir reajuste de preço em massa: timeout' });
    expect(fakeConnector.chamadas).toHaveLength(0);
  });
});

describe('processarFamiliaML — NCM fora da tabela oficial (ADR-0187)', () => {
  beforeEach(() => fakeConnector.reset());

  it('NCM vencido (org com módulo fiscal) → erro definitivo com a copy, zero chamadas ao ML', async () => {
    const { admin, writes } = fakeAdmin({ familia: FAMILIA_FISCAL_OK, modulosHabilitados: ['fiscal'], ncm: 'vencido' });
    const r = await processarFamiliaML(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
    expect((r as { mensagem: string }).mensagem).toMatch(/NCM 39269090 não está mais vigente/);
    expect(fakeConnector.chamadas).toHaveLength(0);
    expect(writes.some((w) => w.table === 'familias' && w.payload.status === 'erro')).toBe(true);
  });

  it('erro lendo ncm_consultar → retry (transitório), zero chamadas ao ML, família não marcada erro', async () => {
    const { admin, writes } = fakeAdmin({ familia: FAMILIA_FISCAL_OK, modulosHabilitados: ['fiscal'], ncm: 'erro' });
    const r = await processarFamiliaML(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('retry');
    expect(fakeConnector.chamadas).toHaveLength(0);
    expect(writes.some((w) => w.table === 'familias' && w.payload.status === 'erro')).toBe(false);
  });
});

describe('processarFamiliaML — CREATE cortado pelo teto (ADR-0195)', () => {
  beforeEach(() => fakeConnector.reset());
  const cores = (a: number, b: number) => multiCor().map((v, i) => ({ ...v, estoque: i === 0 ? a : b }));

  it('soma acima do limite: avisa com a chave do anúncio', async () => {
    const notificar = vi.fn(async () => 1);
    const { admin } = fakeAdmin({ variacoes: cores(80_000, 80_000) });
    const r = await processarFamiliaML(baseDeps(admin, { notificar }), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    const item = (r as { itemExternoId: string }).itemExternoId;
    expect(notificar).toHaveBeenCalledTimes(1);
    expect(notificar).toHaveBeenCalledWith(
      admin, FAMILIA_BASE.org_id, 'estoque', expect.stringContaining(`anúncio ${item}`), { chave: `teto:${item}` },
    );
  });

  it('soma dentro do limite: não avisa', async () => {
    const notificar = vi.fn(async () => 1);
    const { admin } = fakeAdmin({ variacoes: cores(60_000, 39_999) });
    await processarFamiliaML(baseDeps(admin, { notificar }), JOB, { tentativas: 0 });
    expect(notificar).not.toHaveBeenCalled();
  });

  it('falha ao avisar não desfaz a publicação', async () => {
    const notificar = vi.fn(async () => { throw new Error('fora do ar'); });
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin } = fakeAdmin({ variacoes: cores(80_000, 80_000) });
    const r = await processarFamiliaML(baseDeps(admin, { notificar }), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    erro.mockRestore();
  });
});

// ADR-0196: `familias.ml_item_id` em UP é só o 1º filho. Faixa é por item e sobre o preço dele.
describe('processarFamiliaML — retry do atacado em família já publicada', () => {
  const FAIXAS = [{ min_unidades: 2, desconto_pct: 5 }];
  const familia = { ...FAMILIA_BASE, ml_item_id: 'MLB2', atacado: FAIXAS, atacado_status: 'erro', descricao_ml: null };
  const filho = (sku: string, item_externo_id: string, o: Record<string, unknown> = {}) =>
    ({ anuncio_externo_id: 'root-1', sku, item_externo_id, status: 'ativo', retirado: false, ...o });
  const variacoes = [{ ...VAR_BASE, codigo: 'V1', preco_publicacao: 100 }, { ...VAR_BASE, codigo: 'V2', preco_publicacao: 80 }];

  async function rodar(over: Parameters<typeof fakeAdmin>[0], falhar?: string) {
    const aplicados: [string, number][] = [];
    const conn = {
      ...fakeConnector, capabilities: { ...fakeConnector.capabilities, atacado: true },
      aplicarAtacado: async (_c: unknown, id: string, base: number) => {
        if (id === falhar) throw new Error('ML 500');
        aplicados.push([id, base]);
      },
    };
    const { admin, writes } = fakeAdmin({ familia, variacoes, ...over });
    const r = await processarFamiliaML(baseDeps(admin, { conn: conn as never }), JOB, { tentativas: 0 } as never);
    return { r, aplicados, status: writes.filter((w) => w.table === 'familias' && 'atacado_status' in w.payload).map((w) => w.payload) };
  }

  it('UP: cada filho sobre o próprio preço, mesmo com a 1ª variação mais cara', async () => {
    const { r, aplicados, status } = await rodar({ filhosUP: [filho('V1', 'MLB1'), filho('V2', 'MLB2')] });
    expect(r.tipo).toBe('ja_publicado');
    expect(aplicados).toEqual([['MLB1', 100], ['MLB2', 80]]);
    expect(status).toEqual([{ atacado_status: 'aplicado', atacado_erro: null }]);
  });

  it('UP: filho retirado ou sem item fica de fora', async () => {
    const { aplicados } = await rodar({ filhosUP: [filho('V2', 'MLB2'), filho('V1', 'MLB1', { retirado: true }), filho('V3', null as never)] });
    expect(aplicados).toEqual([['MLB2', 80]]);
  });

  it('UP: falha em um filho não vira aplicado', async () => {
    const { status } = await rodar({ filhosUP: [filho('V1', 'MLB1'), filho('V2', 'MLB2')] }, 'MLB1');
    expect(status).toMatchObject([{ atacado_status: 'erro' }]);
  });

  it('UP: filho sem preço → erro, nada enviado', async () => {
    const { aplicados, status } = await rodar({ filhosUP: [filho('V1', 'MLB1'), filho('V9', 'MLB2')] });
    expect(aplicados).toEqual([]);
    expect(status).toMatchObject([{ atacado_status: 'erro' }]);
  });

  it('leitura dos filhos falhou: não trata como Legacy nem grava status', async () => {
    const { aplicados, status } = await rodar({ filhosErro: true });
    expect(aplicados).toEqual([]);
    expect(status).toEqual([]);
  });

  it('Legacy: o item único com preço uniforme', async () => {
    const { aplicados, status } = await rodar({ variacoes: [{ ...VAR_BASE, preco_publicacao: 80 }, { ...VAR_BASE, codigo: 'V2', preco_publicacao: 80 }] });
    expect(aplicados).toEqual([['MLB2', 80]]);
    expect(status).toEqual([{ atacado_status: 'aplicado', atacado_erro: null }]);
  });

  it('Legacy com preços diferentes: não escolhe uma base', async () => {
    const { aplicados, status } = await rodar({});
    expect(aplicados).toEqual([]);
    expect(status).toMatchObject([{ atacado_status: 'erro' }]);
  });
});

// ADR-0204: só o kit vinculado (kit_base_codigo_pai + kit_multiplicador) com a coluna cheia leva a galeria da base.
describe('processarFamiliaML — galeria do kit vinculado (ADR-0204)', () => {
  const KIT = { ...FAMILIA_BASE, kit_base_codigo_pai: '00000082', kit_multiplicador: 2 };
  const COLUNA = [{ id: 'G1', item: 'MLB-BASE' }, { id: 'G2', item: 'MLB-BASE' }];
  const VAR_KIT = { ...VAR_BASE, codigo: 'K1', ml_picture_id: null, galeria_ml_fotos: COLUNA };
  const criado = () => fakeConnector.chamadas.find((c) => c.metodo === 'criarAnuncio')?.args as { galeriaFotoIds?: string[] };
  beforeEach(() => {
    fakeConnector.reset();
    revalidarSpy.mockReset();
    revalidarSpy.mockImplementation(async (_t: string, fotos: unknown[]) => ({ fotos, motivo: null }));
  });

  it('kit vinculado com a coluna cheia → revalida com o token da org e leva os ids aprovados', async () => {
    const notificar = vi.fn(async () => {});
    const { admin } = fakeAdmin({ familia: KIT, variacoes: [VAR_KIT] });
    const r = await processarFamiliaML(baseDeps(admin, { notificar: notificar as never }), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(revalidarSpy).toHaveBeenCalledWith('fake-token', COLUNA);
    expect(criado().galeriaFotoIds).toEqual(['G1', 'G2']);
    expect(notificar).not.toHaveBeenCalled();
  });

  it('revalidação devolve subconjunto → só ele segue e avisa com a chave kit_galeria:<codigo>:reduzida', async () => {
    revalidarSpy.mockResolvedValue({ fotos: [COLUNA[1]], motivo: 'MLB-BASE sem a foto G1' });
    const notificar = vi.fn(async () => {});
    const { admin } = fakeAdmin({ familia: KIT, variacoes: [VAR_KIT] });
    await processarFamiliaML(baseDeps(admin, { notificar: notificar as never }), JOB, { tentativas: 0 });
    expect(criado().galeriaFotoIds).toEqual(['G2']);
    expect(notificar).toHaveBeenCalledWith(
      admin, 'org-1', 'estoque', expect.stringContaining('K1'), { chave: 'kit_galeria:K1:reduzida' },
    );
  });

  it('revalidação sem nenhuma foto aprovada → publica sem galeria, avisa', async () => {
    revalidarSpy.mockResolvedValue({ fotos: [], motivo: 'Galeria das peças não conferida (HTTP 500).' });
    const notificar = vi.fn(async () => {});
    const { admin } = fakeAdmin({ familia: KIT, variacoes: [VAR_KIT] });
    const r = await processarFamiliaML(baseDeps(admin, { notificar: notificar as never }), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(criado()).not.toHaveProperty('galeriaFotoIds');
    expect(notificar).toHaveBeenCalledTimes(1);
  });

  it('revalidação que LANÇA e aviso que falha nunca derrubam a publicação', async () => {
    revalidarSpy.mockRejectedValue(new Error('ECONNRESET'));
    const notificar = vi.fn(async () => { throw new Error('notif fora'); });
    const { admin } = fakeAdmin({ familia: KIT, variacoes: [VAR_KIT] });
    const r = await processarFamiliaML(baseDeps(admin, { notificar: notificar as never }), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(criado()).not.toHaveProperty('galeriaFotoIds');
  });

  it('kit vinculado sem galeria (coluna vazia ou nula) → nada lido, anúncio idêntico ao atual', async () => {
    for (const galeria of [[], null]) {
      fakeConnector.reset();
      const { admin } = fakeAdmin({ familia: KIT, variacoes: [{ ...VAR_KIT, galeria_ml_fotos: galeria }] });
      await processarFamiliaML(baseDeps(admin), JOB, { tentativas: 0 });
      expect(criado()).not.toHaveProperty('galeriaFotoIds');
    }
    expect(revalidarSpy).not.toHaveBeenCalled();
  });

  it('família comum e kit com variação (sem kit_base_codigo_pai) com a coluna cheia → sem galeria', async () => {
    for (const familia of [FAMILIA_BASE, { ...FAMILIA_BASE, kit_multiplicador: 2 }, { ...FAMILIA_BASE, kit_base_codigo_pai: '00000082' }]) {
      fakeConnector.reset();
      const { admin } = fakeAdmin({ familia, variacoes: [VAR_KIT] });
      await processarFamiliaML(baseDeps(admin), JOB, { tentativas: 0 });
      expect(criado()).not.toHaveProperty('galeriaFotoIds');
    }
    expect(revalidarSpy).not.toHaveBeenCalled();
  });

  it('rota UP (SKU com tamanho) também recebe a galeria no anúncio', async () => {
    let visto: string[] | undefined;
    const { admin } = fakeAdmin({
      familia: { ...KIT, genero: 'masculino', categoria_ml_id: 'MLB108803' },
      variacoes: [{ ...VAR_KIT, tamanho: 'P' }],
    });
    const deps = baseDeps(admin, { publicarUP: async (a) => { visto = a.anuncio.galeriaFotoIds; return { estado: 'ativo', itemExternoId: 'X', permalink: null }; } });
    await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(visto).toEqual(['G1', 'G2']);
  });
});

// ADR-0204 item 4: recusa de foto com a galeria no payload rebaixa para só a capa — zera a coluna, nunca limpa o
// cache da capa e a família nunca fica presa em `publicando`.
describe('processarFamiliaML — recusa de foto com a galeria do kit vinculado (ADR-0204 item 4)', () => {
  const KIT = { ...FAMILIA_BASE, kit_base_codigo_pai: '00000082', kit_multiplicador: 2 };
  const KIT_UP = { ...KIT, genero: 'masculino', categoria_ml_id: 'MLB108803' };
  const COLUNA = [{ id: 'G1', item: 'MLB-BASE' }, { id: 'G2', item: 'MLB-BASE' }];
  const VAR_KIT = { ...VAR_BASE, codigo: 'K1', ml_picture_id: null, galeria_ml_fotos: COLUNA };
  const CAUSA_FOTO = [{ code: 'item.pictures.invalid', type: 'error' }];
  const MSG_FOTO = 'Problema nas fotos do anúncio. Verifique as imagens das variações.';
  type Escrita = { table: string; payload: Record<string, unknown>; filters: Record<string, unknown> };

  beforeEach(() => {
    fakeConnector.reset();
    revalidarSpy.mockReset();
    revalidarSpy.mockImplementation(async (_t: string, fotos: unknown[]) => ({ fotos, motivo: null }));
  });

  /** Conector cujos POSTs seguem `respostas` em ordem (sucesso quando acabam); guarda a galeria de cada chamada. */
  function connRoteiro(respostas: Array<Record<string, unknown>>) {
    const galerias: Array<string[] | undefined> = [];
    const conn = {
      ...fakeConnector,
      criarAnuncio: async (_ctx: unknown, a: { galeriaFotoIds?: string[] }) => {
        galerias.push(a.galeriaFotoIds ? [...a.galeriaFotoIds] : undefined);
        const erro = respostas[galerias.length - 1];
        return erro ? { ok: false, erro } : { ok: true, valor: { itemExternoId: 'MLB-KIT', variacoesExternas: { K1: 'MLB-KIT' } } };
      },
    } as never;
    return { conn, galerias };
  }
  const erroFotoLegacy = { codigo: 'DESCONHECIDO', mensagemOperador: MSG_FOTO, retentavel: false, status: 400, raw: { mlCauses: CAUSA_FOTO } };
  const zerou = (writes: Escrita[]) =>
    writes.filter((w) => w.table === 'variacoes' && Array.isArray(w.payload.galeria_ml_fotos) && (w.payload.galeria_ml_fotos as unknown[]).length === 0);
  const limpouCache = (writes: Escrita[]) =>
    writes.some((w) => w.payload.ml_picture_id === null || w.payload.capa_ml_picture_id === null);
  function erroUP(status: number, mlCauses: unknown, retentavel = false) {
    const e = new Error(MSG_FOTO) as Error & { status?: number; mlCauses?: unknown; retentavel?: boolean };
    e.status = status; e.mlCauses = mlCauses; e.retentavel = retentavel;
    return e;
  }

  it('Legacy: recusa de foto com galeria → 2º POST sem galeria, coluna zerada, cache intacto, kit criado', async () => {
    const notificar = vi.fn(async () => {});
    const { admin, writes } = fakeAdmin({ familia: KIT, variacoes: [{ ...VAR_KIT }] });
    const { conn, galerias } = connRoteiro([erroFotoLegacy]);
    const r = await processarFamiliaML(baseDeps(admin, { conn, notificar: notificar as never }), JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'ok', itemExternoId: 'MLB-KIT' });
    expect(galerias).toEqual([['G1', 'G2'], undefined]);
    const z = zerou(writes);
    expect(z).toHaveLength(1);
    expect(z[0].payload.galeria_ml_fotos).toEqual([]); // array, nunca a string '[]'
    expect(z[0].filters).toEqual(expect.objectContaining({ org_id: 'org-1', familia_id: 'fam-1' }));
    expect(limpouCache(writes)).toBe(false);
    expect(notificar).toHaveBeenCalledWith(admin, 'org-1', 'estoque', expect.stringContaining('K1'), { chave: 'kit_galeria:K1:recusada' });
  });

  it('Legacy: 2º POST também recusado segue o caminho atual (já sem galeria)', async () => {
    const { admin, writes } = fakeAdmin({ familia: KIT, variacoes: [{ ...VAR_KIT }] });
    const { conn, galerias } = connRoteiro([erroFotoLegacy, erroFotoLegacy]);
    const r = await processarFamiliaML(baseDeps(admin, { conn }), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
    expect(galerias).toEqual([['G1', 'G2'], undefined]);
    expect(limpouCache(writes)).toBe(true); // a culpada agora é a capa: comportamento de sempre
  });

  it('Legacy: unavailable com galeria e tentativas esgotadas → zera e reenvia sem galeria, cache intacto', async () => {
    const { admin, writes } = fakeAdmin({ familia: KIT, variacoes: [{ ...VAR_KIT }] });
    const { conn, galerias } = connRoteiro([{ codigo: 'FOTO', mensagemOperador: 'item.pictures.unavailable', retentavel: true, status: 400 }]);
    const r = await processarFamiliaML(baseDeps(admin, { conn }), JOB, { tentativas: 10 });
    expect(r.tipo).toBe('ok');
    expect(galerias).toEqual([['G1', 'G2'], undefined]);
    expect(zerou(writes)).toHaveLength(1);
    expect(limpouCache(writes)).toBe(false);
  });

  it('Legacy: unavailable com galeria ainda na janela → retry de sempre, galeria mantida', async () => {
    const { admin, writes } = fakeAdmin({ familia: KIT, variacoes: [{ ...VAR_KIT }] });
    const { conn, galerias } = connRoteiro([{ codigo: 'FOTO', mensagemOperador: 'item.pictures.unavailable', retentavel: true, status: 400 }]);
    const r = await processarFamiliaML(baseDeps(admin, { conn }), JOB, { tentativas: 3 });
    expect(r).toEqual({ tipo: 'retry', mensagem: 'item.pictures.unavailable' });
    expect(galerias).toHaveLength(1);
    expect(zerou(writes)).toHaveLength(0);
  });

  it('Legacy: erro de foto SEM galeria → comportamento atual (um POST, cache limpo, erro)', async () => {
    const { admin, writes } = fakeAdmin({ familia: KIT, variacoes: [{ ...VAR_KIT, galeria_ml_fotos: [] }] });
    const { conn, galerias } = connRoteiro([erroFotoLegacy]);
    const r = await processarFamiliaML(baseDeps(admin, { conn }), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
    expect(galerias).toEqual([undefined]);
    expect(zerou(writes)).toHaveLength(0);
    expect(limpouCache(writes)).toBe(true);
  });

  it('Legacy: erro que não é de foto com galeria → intacto (um POST, sem zerar)', async () => {
    const { admin, writes } = fakeAdmin({ familia: KIT, variacoes: [{ ...VAR_KIT }] });
    const { conn, galerias } = connRoteiro([{ ...erroFotoLegacy, mensagemOperador: 'preço inválido', raw: { mlCauses: [{ code: 'item.price.invalid' }] } }]);
    const r = await processarFamiliaML(baseDeps(admin, { conn }), JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'erro', mensagem: 'preço inválido' });
    expect(galerias).toHaveLength(1);
    expect(zerou(writes)).toHaveLength(0);
  });

  it('UP: exceção com mlCauses de foto → zera, retry, sem marcar erro nem limpar cache', async () => {
    const notificar = vi.fn(async () => {});
    const { admin, writes } = fakeAdmin({ familia: KIT_UP, variacoes: [{ ...VAR_KIT, tamanho: 'P' }] });
    const deps = baseDeps(admin, { notificar: notificar as never, publicarUP: async () => { throw erroUP(400, CAUSA_FOTO); } });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 3 });
    expect(r).toEqual({ tipo: 'retry', mensagem: MSG_FOTO });
    expect(zerou(writes)).toHaveLength(1);
    expect(limpouCache(writes)).toBe(false);
    expect(writes.some((w) => w.table === 'familias' && w.payload.status === 'erro')).toBe(false);
    expect(notificar).toHaveBeenCalledWith(admin, 'org-1', 'estoque', expect.any(String), { chave: 'kit_galeria:K1:recusada' });
  });

  it('UP: na última tentativa → status erro com a mensagem do operador, sem limpar cache', async () => {
    const { admin, writes } = fakeAdmin({ familia: KIT_UP, variacoes: [{ ...VAR_KIT, tamanho: 'P' }] });
    const deps = baseDeps(admin, { publicarUP: async () => { throw erroUP(400, CAUSA_FOTO); } });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 10 });
    expect(r).toEqual({ tipo: 'erro', mensagem: MSG_FOTO });
    expect(zerou(writes)).toHaveLength(1);
    expect(limpouCache(writes)).toBe(false);
    expect(writes).toContainEqual(expect.objectContaining({ table: 'familias', payload: { status: 'erro', erro_mensagem: MSG_FOTO } }));
  });

  it('UP: unavailable com galeria e tentativas esgotadas → zera, erro, sem limpar cache', async () => {
    const { admin, writes } = fakeAdmin({ familia: KIT_UP, variacoes: [{ ...VAR_KIT, tamanho: 'P' }] });
    const deps = baseDeps(admin, { publicarUP: async () => { throw erroUP(400, [{ code: 'item.pictures.unavailable' }], true); } });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 10 });
    expect(r.tipo).toBe('erro');
    expect(zerou(writes)).toHaveLength(1);
    expect(limpouCache(writes)).toBe(false);
  });

  it('UP: erro de foto SEM galeria → comportamento atual (erro + cache limpo)', async () => {
    const { admin, writes } = fakeAdmin({ familia: KIT_UP, variacoes: [{ ...VAR_KIT, tamanho: 'P', galeria_ml_fotos: [] }] });
    const deps = baseDeps(admin, { publicarUP: async () => { throw erroUP(400, CAUSA_FOTO); } });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 3 });
    expect(r.tipo).toBe('erro');
    expect(zerou(writes)).toHaveLength(0);
    expect(limpouCache(writes)).toBe(true);
  });

  // Fix round 1: `item.pictures.error` vem marcado retentável pela mensagem ("try again") e vira codigo 'FOTO'.
  const erroFotoTransitorio = {
    codigo: 'FOTO', mensagemOperador: 'item.pictures.error', retentavel: true, status: 400,
    raw: { mlCauses: [{ code: 'item.pictures.error' }] },
  };

  it('Legacy: item.pictures.error retentável na tentativa 0 → NÃO zera, sem 2º POST, retry de sempre', async () => {
    const { admin, writes } = fakeAdmin({ familia: KIT, variacoes: [{ ...VAR_KIT }] });
    const { conn, galerias } = connRoteiro([erroFotoTransitorio]);
    const r = await processarFamiliaML(baseDeps(admin, { conn }), JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'retry', mensagem: 'item.pictures.error' });
    expect(galerias).toEqual([['G1', 'G2']]);
    expect(zerou(writes)).toHaveLength(0);
    expect(limpouCache(writes)).toBe(false);
  });

  it('Legacy: item.pictures.error retentável com tentativas esgotadas → zera e reenvia sem galeria', async () => {
    const { admin, writes } = fakeAdmin({ familia: KIT, variacoes: [{ ...VAR_KIT }] });
    const { conn, galerias } = connRoteiro([erroFotoTransitorio]);
    const r = await processarFamiliaML(baseDeps(admin, { conn }), JOB, { tentativas: 10 });
    expect(r.tipo).toBe('ok');
    expect(galerias).toEqual([['G1', 'G2'], undefined]);
    expect(zerou(writes)).toHaveLength(1);
    expect(limpouCache(writes)).toBe(false);
  });

  it('UP: item.pictures.error retentável na tentativa 0 → retry sem zerar', async () => {
    const { admin, writes } = fakeAdmin({ familia: KIT_UP, variacoes: [{ ...VAR_KIT, tamanho: 'P' }] });
    const deps = baseDeps(admin, { publicarUP: async () => { throw erroUP(400, [{ code: 'item.pictures.error' }], true); } });
    const r = await processarFamiliaML(deps, JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'retry', mensagem: MSG_FOTO });
    expect(zerou(writes)).toHaveLength(0);
  });

  it('helper: UPDATE da coluna falhou → devolve false e não avisa (cai no caminho atual)', async () => {
    const notificar = vi.fn(async () => 0);
    const update = () => ({ eq: () => ({ eq: async () => ({ error: { message: 'rls' } }) }) });
    const ok = await rebaixarGaleriaSeRecusada({
      admin: { from: () => ({ update }) } as never, orgId: 'org-1', familiaId: 'fam-1', codigo: 'K1',
      galeriaUsada: true, tentativas: 0, erro: { status: 400, mlCauses: CAUSA_FOTO, retentavel: false },
      notificar: notificar as never,
    });
    expect(ok).toBe(false);
    expect(notificar).not.toHaveBeenCalled();
  });

  it('UP: retry posterior lê a coluna zerada e não reinsere a galeria', async () => {
    const v = { ...VAR_KIT, tamanho: 'P' };
    const { admin, writes } = fakeAdmin({ familia: KIT_UP, variacoes: [v] });
    const vistos: Array<string[] | undefined> = [];
    let chamada = 0;
    const deps = baseDeps(admin, {
      publicarUP: async (a) => {
        vistos.push(a.anuncio.galeriaFotoIds);
        if (chamada++ === 0) throw erroUP(400, CAUSA_FOTO);
        return { estado: 'ativo', itemExternoId: 'MLB-KIT', permalink: null };
      },
    });
    expect((await processarFamiliaML(deps, JOB, { tentativas: 0 })).tipo).toBe('retry');
    Object.assign(v, zerou(writes)[0].payload); // o UPDATE chegou na linha
    expect((await processarFamiliaML(deps, JOB, { tentativas: 1 })).tipo).toBe('ok');
    expect(vistos).toEqual([['G1', 'G2'], undefined]);
  });
});
