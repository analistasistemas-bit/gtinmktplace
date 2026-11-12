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

// ADR-0195: spies por cima das funções reais, para o teste de falha passar pelo try/catch de verdade.
const { registrarSpy, agendarSpy } = vi.hoisted(() => ({ registrarSpy: vi.fn(), agendarSpy: vi.fn() }));
vi.mock('../../_shared/confirmacao/registrar.ts', async (original) => {
  const real = await original<typeof import('../../_shared/confirmacao/registrar')>();
  registrarSpy.mockImplementation(real.registrarConfirmacao);
  agendarSpy.mockImplementation(real.agendarConfirmacao);
  return { ...real, registrarConfirmacao: registrarSpy, agendarConfirmacao: agendarSpy };
});

import { processarAtualizacaoFamilia, mensagemNotificacaoAddVariacao, type ProcessarDeps } from '../processar';
import { fakeConnector } from '../../_shared/canais/fake';
import type { ResultadoAtualizarUP } from '../../_shared/user-products/atualizar-familia-up';

const FAMILIA_BASE = {
  id: 'fam-1', user_id: 'user-1', org_id: 'org-1', codigo_pai: '03103331', nome_pai: 'AGULHA',
  titulo_ml: 'AGULHA MATTE', descricao_ml: 'Desc', categoria_ml_id: 'MLB419782', atributos_ml: [],
  ml_item_id: 'MLB-EXISTENTE', ml_permalink: 'https://ml/x', status: 'publicando', atacado: null, atacado_status: null,
  fornecedor: null, capa_ml_picture_id: 'CAPA', capa2_ml_picture_id: null, capa2_storage_path: null,
  capa3_ml_picture_id: null, capa3_storage_path: null, variacao_principal_codigo: null,
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
  familiaUpdateErr?: boolean; // ADR-0195: gravar em familias falha
  lote?: Record<string, unknown> | null; // ADR-0129 D-11: lotes.select('origem')
  modulosHabilitados?: string[];
  org?: { marca_padrao: string | null; marca_propria: boolean }; // ADR-0186
  reajusteAtivo?: string | null; // rpc reajuste_ativo_produto (spec reajuste C2)
  reajusteErro?: boolean;         // rpc reajuste_ativo_produto falha (timeout, função ausente)
  ncm?: 'vigente' | 'vencido' | 'inexistente' | 'erro'; // rpc ncm_consultar (ADR-0187)
  kitComponentes?: string[]; // ADR-0200: SKUs usados em kit com variação
  estender?: boolean; // ADR-0201: ml_estender_trava (default true)
  excluidas?: Record<string, unknown>[]; // variações com excluida_da_publicacao=true (desmarcadas na Revisão)
  excluidasErr?: boolean;                // a leitura das desmarcadas falha
} = {}) {
  const rpcs: Array<{ fn: string; args: unknown }> = [];
  const writes: Array<{ table: string; payload: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const familia = over.familia === undefined ? { ...FAMILIA_BASE } : over.familia;
  const variacoes = over.variacoes ?? [{ ...VAR_CASADA }];
  const conexao = over.conexao === undefined ? CONEXAO_ROW : over.conexao;
  const raizUP = over.raizUP ?? null;
  const itensUP = over.itensUP ?? [];
  // Default = lote de planilha existente: `ehFluxoAddVariacao` falha alto em lote ausente.
  const lote = over.lote === undefined ? { origem: 'planilha' } : over.lote;
  const modulosHabilitados = over.modulosHabilitados ?? [];
  function chain(table: string) {
    const rec = { table, op: '', filters: {} as Record<string, unknown>, payload: {} as Record<string, unknown> };
    const ler = () => {
      if (table === 'familias') return familia;
      if (table === 'variacoes') return rec.filters.excluida_da_publicacao === true ? (over.excluidas ?? []) : variacoes;
      if (table === 'marketplace_connections') return conexao;
      if (table === 'organizations') return { modulos_habilitados: modulosHabilitados, ...(over.org ?? { marca_padrao: 'Avil', marca_propria: false }) };
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
        if (rec.op === 'update' && table === 'familias' && over.familiaUpdateErr) {
          return Promise.resolve({ data: null, error: { message: 'boom-familia' } }).then(resolve);
        }
        if (table === 'variacoes' && over.excluidasErr && rec.filters.excluida_da_publicacao === true) {
          return Promise.resolve({ data: null, error: { message: 'boom-excluidas' } }).then(resolve);
        }
        if (table === 'anuncios_externos_itens' && over.itensErr) return Promise.resolve({ data: null, error: { message: 'boom-itens' } }).then(resolve);
        return Promise.resolve({ data: rec.op === 'update' ? null : ler(), error: null }).then(resolve);
      },
    };
    return api;
  }
  const storage = { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'x' }, error: null }) }) };
  const rpc = async (fn: string, args?: { p_codigos?: string[] }) => {
    rpcs.push({ fn, args });
    // ADR-0201: trava de escrita por MLB (aquisição pelo `reservar` injetado; aqui só extensão e soltura).
    if (fn === 'ml_estender_trava') return { data: over.estender ?? true, error: null };
    if (fn === 'ml_soltar_itens') return { data: 1, error: null };
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
  return { admin: { from: chain, storage, rpc } as never, writes, rpcs };
}

// ADR-0201: por padrão o item está livre (a reserva real é testada em _shared/ml/__tests__/trava-item.test.ts).
const reservaLivre = vi.fn(async () => ({ tipo: 'livre' as const, dono: 'dono-job', posseAdiada: null }));
function baseDeps(admin: never, extra: Partial<ProcessarDeps> = {}): ProcessarDeps {
  return { admin, conn: fakeConnector as never, finalizarLote: async () => {}, reservar: reservaLivre, ...extra };
}

beforeEach(() => {
  fakeConnector.reset(); enfileirarSpy.mockReset(); espelharSpy.mockReset();
  notificarCategoriaSpy.mockReset(); enfileirarFiscalSpy.mockClear();
  registrarSpy.mockClear(); agendarSpy.mockClear();
});

describe('processarAtualizacaoFamilia — registra a conferência no ML (ADR-0195)', () => {
  const ENVIADO = { V1: { qtd: 3, anterior: 9, variacao_id: 'MLV1' } };
  const conferencia = () => registrarSpy.mock.calls[0][1];

  it('Legacy: registra modelo variacoes, capados e agenda com a mesma versão, capturada antes do PUT', async () => {
    const { admin } = fakeAdmin();
    let antesDoPut = '';
    const spy = vi.spyOn(fakeConnector, 'atualizarAnuncio').mockImplementationOnce(async () => {
      antesDoPut = new Date().toISOString();
      return { ok: true, valor: { variacoesExternas: { V1: 'MLV1' }, precoVivo: null, enviados: ENVIADO } };
    });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    spy.mockRestore();
    expect(r.tipo).toBe('ok');
    expect(conferencia()).toMatchObject({
      orgId: 'org-1', loteId: 'lote-1', familiaId: 'fam-1', codigoPai: '03103331',
      itens: [{ itemExternoId: 'MLB-EXISTENTE', modelo: 'variacoes', enviado: ENVIADO, capados: 1 }],
    });
    expect(conferencia().enviadoEm <= antesDoPut).toBe(true);
    expect(agendarSpy).toHaveBeenCalledTimes(1);
    expect(agendarSpy).toHaveBeenCalledWith('fam-1', conferencia().enviadoEm);
  });

  it('kit vinculado não entra na conferência: o ledger baixa o SKU base, não o do kit', async () => {
    const { admin } = fakeAdmin({ familia: { ...FAMILIA_BASE, kit_base_codigo_pai: '00000001', kit_multiplicador: 2 } });
    const spy = vi.spyOn(fakeConnector, 'atualizarAnuncio').mockImplementationOnce(async () => (
      { ok: true, valor: { variacoesExternas: { V1: 'MLV1' }, precoVivo: null, enviados: ENVIADO } }
    ));
    await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    spy.mockRestore();
    expect(registrarSpy).not.toHaveBeenCalled();
    expect(agendarSpy).not.toHaveBeenCalled();
  });

  it('Legacy item plano: modelo item', async () => {
    const { admin } = fakeAdmin();
    const spy = vi.spyOn(fakeConnector, 'atualizarAnuncio').mockResolvedValueOnce({
      ok: true,
      valor: { variacoesExternas: { V1: 'MLB-EXISTENTE' }, precoVivo: null, enviados: { V1: { qtd: 5, anterior: 2, variacao_id: null } } },
    });
    await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    spy.mockRestore();
    expect(conferencia().itens[0]).toMatchObject({ modelo: 'item', capados: 0 });
  });

  it('sem enviados (fluxo Adicionar variação) não registra nem agenda', async () => {
    const { admin } = fakeAdmin();
    await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(registrarSpy).not.toHaveBeenCalled();
    expect(agendarSpy).not.toHaveBeenCalled();
  });

  it('falha ao registrar e ao agendar não muda o desfecho', async () => {
    // O fakeAdmin não tem upsert e o mock de queue.ts não tem enfileirarConfirmacao: as duas reais falham por dentro.
    const { admin } = fakeAdmin();
    const spy = vi.spyOn(fakeConnector, 'atualizarAnuncio').mockResolvedValueOnce({
      ok: true, valor: { variacoesExternas: { V1: 'MLV1' }, precoVivo: null, enviados: ENVIADO },
    });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    spy.mockRestore();
    expect(registrarSpy).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ tipo: 'ok', itemExternoId: 'MLB-EXISTENTE', novas: 0 });
  });

  it('UP: registra um item por filho e agenda; versão capturada antes da saga', async () => {
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T', criado_em: null }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }] });
    let antesDaSaga = '';
    const enviados = [
      { itemExternoId: 'MLB-IT1', modelo: 'item' as const, capados: 0, enviado: { V1: { qtd: 5, anterior: null, variacao_id: null } } },
    ];
    const deps = baseDeps(admin, {
      atualizarUP: async (): Promise<ResultadoAtualizarUP> => {
        antesDaSaga = new Date().toISOString();
        return { estado: 'ok', adicionadas: 0, enviados };
      },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(conferencia().itens).toEqual(enviados);
    expect(conferencia().enviadoEm <= antesDaSaga).toBe(true);
    expect(agendarSpy).toHaveBeenCalledWith('fam-1', conferencia().enviadoEm);
  });

  it('UP em retry ou erro não registra', async () => {
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T', criado_em: null }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }] });
    await processarAtualizacaoFamilia(baseDeps(admin, {
      atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'retry', mensagem: 'x' }),
    }), JOB, { tentativas: 0 });
    await processarAtualizacaoFamilia(baseDeps(admin, {
      atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'erro', mensagem: 'x' }),
    }), JOB, { tentativas: 0 });
    expect(registrarSpy).not.toHaveBeenCalled();
  });
});

// Incidente 12/11/2026 (produto 92710170): no "Adicionar variação" (lote manual, ADR-0129) a Revisão ficou com
// 1 de 8 cores marcada, e a saga pausou e retirou as 7 desmarcadas. O fluxo só adiciona cor: o worker recusa
// antes de qualquer escrita.
describe('processarAtualizacaoFamilia — Adicionar variação recusa cor desmarcada já publicada', () => {
  const MANUAL = { origem: 'manual' };
  const OITO = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'];
  const RAIZ = { id: 'root-1', titulo: 'T', criado_em: null };
  const vivos = OITO.map((sku, i) => ({ id: `it-${i}`, sku, item_externo_id: `MLB${i + 1}`, retirado: false, status: 'ativo' }));
  const marcada = (codigo: string) => ({ ...VAR_CASADA, codigo, ml_variation_id: null });
  const desmarcada = (codigo: string, ml_variation_id: string | null = null) => ({ codigo, ml_variation_id });
  const SETE = OITO.slice(1).map((c) => desmarcada(c));

  async function rodar(over: Parameters<typeof fakeAdmin>[0], job: Record<string, unknown> = {}) {
    const { admin, writes } = fakeAdmin(over);
    const upArgs: unknown[] = [];
    let finalizou = false;
    const deps = baseDeps(admin, {
      atualizarUP: async (a): Promise<ResultadoAtualizarUP> => { upArgs.push(a); return { estado: 'ok', adicionadas: 0 }; },
      finalizarLote: async () => { finalizou = true; },
    });
    const r = await processarAtualizacaoFamilia(deps, { ...JOB, ...job }, { tentativas: 0 });
    const familia = writes.filter((w) => w.table === 'familias').map((w) => w.payload);
    return { r, upArgs, familia, finalizou, escritasML: fakeConnector.chamadas.filter((c) => c.metodo !== 'buscarAnuncio') };
  }

  it('8 cores no ar, 7 desmarcadas: família em erro com a mensagem; saga e ML intocados', async () => {
    const { r, upArgs, familia, finalizou, escritasML } = await rodar({
      lote: MANUAL, raizUP: RAIZ, itensUP: vivos, variacoes: [marcada('C1')], excluidas: SETE,
    });
    const mensagem = 'UPDATE bloqueado: 7 cor(es) desmarcada(s) já publicada(s) no Mercado Livre '
      + "(C2, C3, C4, C5, C6, C7, C8). Em 'Adicionar variação' nenhuma cor pode ser desmarcada. "
      + 'Nada foi enviado. Marque todas as cores e reenvie.';
    expect(r).toEqual({ tipo: 'erro', mensagem });
    expect(upArgs).toHaveLength(0);
    expect(escritasML).toEqual([]);
    expect(familia).toEqual([{ status: 'erro', erro_mensagem: mensagem }]);
    expect(finalizou).toBe(true);
  });

  it('controle: todas as cores marcadas → segue para a saga normalmente', async () => {
    const { r, upArgs, familia } = await rodar({
      lote: MANUAL, raizUP: RAIZ, itensUP: vivos, variacoes: OITO.map(marcada), excluidas: [],
    });
    expect(r.tipo).toBe('ok');
    expect(upArgs).toHaveLength(1);
    expect((upArgs[0] as { preservarPublicadas?: boolean }).preservarPublicadas).toBe(true);
    expect(familia.some((p) => p.status === 'erro')).toBe(false);
  });

  it('desmarcada que não está no ar (cor nova, ou já retirada) não bloqueia', async () => {
    const itens = [...vivos.slice(0, 7), { ...vivos[7], retirado: true, status: 'pausado' }];
    const { r, upArgs } = await rodar({
      lote: MANUAL, raizUP: RAIZ, itensUP: itens, variacoes: OITO.slice(0, 7).map(marcada),
      excluidas: [desmarcada('C8'), desmarcada('NOVA')],
    });
    expect(r.tipo).toBe('ok');
    expect(upArgs).toHaveLength(1);
  });

  it('Legacy: desmarcada com ml_variation_id → mesma recusa, nenhum PUT', async () => {
    const { r, escritasML, familia } = await rodar({ lote: MANUAL, excluidas: [desmarcada('V2', 'MLV2')] });
    expect(r.tipo).toBe('erro');
    expect((r as { mensagem: string }).mensagem).toMatch(/^UPDATE bloqueado: 1 cor\(es\) desmarcada\(s\).*\(V2\)/);
    expect(escritasML).toEqual([]);
    expect(familia).toContainEqual(expect.objectContaining({ status: 'erro' }));
  });

  it('falha ao ler as desmarcadas → aborta sem escrever (erro de leitura nunca vira "sem desmarcadas")', async () => {
    const { r, upArgs, escritasML } = await rodar({
      lote: MANUAL, raizUP: RAIZ, itensUP: vivos, variacoes: [marcada('C1')], excluidasErr: true,
    });
    expect(r.tipo).not.toBe('ok');
    expect((r as { mensagem: string }).mensagem).toContain('boom-excluidas');
    expect(upArgs).toHaveLength(0);
    expect(escritasML).toEqual([]);
  });

  it('falha ao ler os itens do anúncio → aborta sem escrever', async () => {
    const { r, upArgs, escritasML } = await rodar({
      lote: MANUAL, raizUP: RAIZ, itensUP: vivos, variacoes: [marcada('C1')], excluidas: SETE, itensErr: true,
    });
    expect(r.tipo).not.toBe('ok');
    expect(upArgs).toHaveLength(0);
    expect(escritasML).toEqual([]);
  });

  it('UPDATE de planilha com as mesmas 7 desmarcadas: nada muda, segue para a saga', async () => {
    const { r, upArgs } = await rodar({ raizUP: RAIZ, itensUP: vivos, variacoes: [marcada('C1')], excluidas: SETE });
    expect(r.tipo).toBe('ok');
    expect(upArgs).toHaveLength(1);
    expect((upArgs[0] as { preservarPublicadas?: boolean }).preservarPublicadas).toBe(false);
  });

  it('somente estoque em lote manual: nada muda (esse modo nunca mexe na composição)', async () => {
    const { r, upArgs } = await rodar(
      { lote: MANUAL, raizUP: RAIZ, itensUP: vivos, variacoes: [marcada('C1')], excluidas: SETE },
      { somenteEstoque: true },
    );
    expect(r.tipo).toBe('ok');
    expect(upArgs).toHaveLength(1);
  });
});

describe('processarAtualizacaoFamilia — roteamento UP vs Legacy', () => {
  it('família COM linhas em anuncios_externos_itens → caminho UP; Legacy (atualizarAnuncio) NUNCA chamado', async () => {
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'AGULHA MATTE', criado_em: '2026-07-22T00:00:00Z' }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }] });
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

  // ADR-0195 — lote #68: 77 filhos sem item sobre um anúncio Legacy vivo. Em somente estoque ninguém
  // escrevia e a família terminava `publicado`; em "Atualizar tudo" a saga criaria 77 anúncios.
  describe.each([[true], [false]])('criação UP pendente (somenteEstoque=%s)', (somenteEstoque) => {
    it('raiz com filhos e nenhum item real → erro; nada no ML; nunca publicado', async () => {
      const { admin, writes } = fakeAdmin({
        raizUP: { id: 'root-1', titulo: 'T', criado_em: null },
        itensUP: [
          { id: 'a', item_externo_id: null, retirado: false },
          { id: 'b', item_externo_id: null, retirado: false },
        ],
      });
      const upArgs: unknown[] = [];
      let finalizou = false;
      const deps = baseDeps(admin, {
        atualizarUP: async (a): Promise<ResultadoAtualizarUP> => { upArgs.push(a); return { estado: 'ok', adicionadas: 0 }; },
        finalizarLote: async () => { finalizou = true; },
      });
      const r = await processarAtualizacaoFamilia(deps, { ...JOB, somenteEstoque }, { tentativas: 0 });
      expect(r.tipo).toBe('erro');
      expect(upArgs).toHaveLength(0);
      expect(fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarAnuncio')).toHaveLength(0);
      const familia = writes.filter((w) => w.table === 'familias').map((w) => w.payload);
      expect(familia).toContainEqual(expect.objectContaining({
        status: 'erro', erro_mensagem: expect.stringMatching(/^Criação em User Products pendente: 2 cor/),
      }));
      expect(familia.some((p) => p.status === 'publicado')).toBe(false);
      expect(finalizou).toBe(true);
    });
  });

  describe('ADR-0195: aviso de família sem item', () => {
    const raizOrfa = {
      raizUP: { id: 'root-1', titulo: 'T', criado_em: null },
      itensUP: [{ id: 'a', item_externo_id: null, retirado: false }],
    };

    it('trava do roteamento avisa na categoria estoque, com chave por família', async () => {
      const { admin } = fakeAdmin(raizOrfa);
      await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
      expect(notificarCategoriaSpy).toHaveBeenCalledTimes(1);
      const [, , categoria, texto, opcoes] = notificarCategoriaSpy.mock.calls[0];
      expect(categoria).toBe('estoque');
      expect(texto).toContain('Estoque não enviado ao Mercado Livre');
      expect(opcoes).toEqual({ chave: `up-sem-item:${JOB.familia_id}` });
    });

    it('saga devolvendo semItem também avisa', async () => {
      const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T', criado_em: null }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }] });
      const deps = baseDeps(admin, {
        atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'erro', mensagem: 'm', semItem: 3 }),
      });
      await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
      expect(notificarCategoriaSpy).toHaveBeenCalledTimes(1);
    });

    it('erro comum da saga não avisa', async () => {
      const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T', criado_em: null }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }] });
      const deps = baseDeps(admin, {
        atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'erro', mensagem: 'm' }),
      });
      await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
      expect(notificarCategoriaSpy).not.toHaveBeenCalled();
    });

    it('falha ao notificar não muda o resultado', async () => {
      notificarCategoriaSpy.mockRejectedValueOnce(new Error('telegram fora'));
      const { admin } = fakeAdmin(raizOrfa);
      const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
      expect(r.tipo).toBe('erro');
    });
  });

  it('filho retirado com item real e outro pendente → composição legítima, segue o caminho UP', async () => {
    const { admin } = fakeAdmin({
      raizUP: { id: 'root-1', titulo: 'T', criado_em: null },
      itensUP: [
        { id: 'a', item_externo_id: 'MLB-A', retirado: true },
        { id: 'b', item_externo_id: null, retirado: false },
      ],
    });
    const upArgs: unknown[] = [];
    const deps = baseDeps(admin, {
      atualizarUP: async (a): Promise<ResultadoAtualizarUP> => { upArgs.push(a); return { estado: 'ok', adicionadas: 1 }; },
    });
    await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(upArgs).toHaveLength(1);
  });

  it('falha ao gravar o erro da trava → retry, não encerra como erro com a família presa', async () => {
    const { admin } = fakeAdmin({
      raizUP: { id: 'root-1', titulo: 'T', criado_em: null },
      itensUP: [{ id: 'a', item_externo_id: null, retirado: false }],
      familiaUpdateErr: true,
    });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('retry');
    expect(notificarCategoriaSpy).not.toHaveBeenCalled();
  });

  it('filhos todos retirados e sem item → não é criação pendente: segue o caminho UP', async () => {
    const { admin } = fakeAdmin({
      raizUP: { id: 'root-1', titulo: 'T', criado_em: null },
      itensUP: [{ id: 'a', item_externo_id: null, retirado: true }],
    });
    const upArgs: unknown[] = [];
    const deps = baseDeps(admin, {
      atualizarUP: async (a): Promise<ResultadoAtualizarUP> => { upArgs.push(a); return { estado: 'ok', adicionadas: 0 }; },
    });
    await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(upArgs).toHaveLength(1);
  });

  // ADR-0160 (I1/I2) — a trava de preço uniforme saiu de antes do roteamento e foi para dentro do
  // ramo Legacy. Estes dois testes vivem no WORKER de propósito: os testes de unidade do guard
  // continuariam verdes se alguém devolvesse a chamada para antes do roteamento, e o efeito seria
  // exatamente o bug que esta entrega corrige — família User Products barrada por um preço
  // divergente que ela tem todo direito de ter.
  it('I2: família UP com preços DIVERGENTES atravessa o worker (não é barrada pelo guard Legacy)', async () => {
    const divergentes = [
      { ...VAR_CASADA, ml_variation_id: null },
      { ...VAR_CASADA, codigo: 'V2', ml_variation_id: null, preco_publicacao: 45.5 },
    ];
    const { admin } = fakeAdmin({
      raizUP: { id: 'root-1', titulo: 'T', criado_em: null }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }],
      variacoes: divergentes,
    });
    const upArgs: Array<Record<string, unknown>> = [];
    const deps = baseDeps(admin, {
      atualizarUP: async (a): Promise<ResultadoAtualizarUP> => { upArgs.push(a as never); return { estado: 'ok', adicionadas: 0 }; },
    });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(upArgs).toHaveLength(1);
    expect(r.tipo).toBe('ok');
  });

  it('I1: família LEGACY com preços divergentes continua sendo barrada (400), sem chamar o ML', async () => {
    const divergentes = [
      { ...VAR_CASADA },
      { ...VAR_CASADA, codigo: 'V2', ml_variation_id: 'MLV2', preco_publicacao: 45.5 },
    ];
    const { admin } = fakeAdmin({ raizUP: null, itensUP: [], variacoes: divergentes });
    const deps = baseDeps(admin);
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
    // A mensagem importa: sem este assert, qualquer erro (rede, fixture) satisfaria o teste e a
    // remoção do guard passaria despercebida.
    expect((r as { mensagem: string }).mensagem).toMatch(/preços divergentes/i);
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarAnuncio')).toHaveLength(0);
  });

  // ADR-0160 (I10) — `preservarPublicadas` subiu para antes do roteamento. Sem este assert,
  // devolvê-lo para depois do `return rodarUP` (o bug B4) passaria despercebido: o teste de unidade
  // da saga continuaria verde porque recebe o parâmetro diretamente.
  it('I10: fluxo "adicionar variação" propaga preservarPublicadas para a rota UP', async () => {
    const { admin } = fakeAdmin({
      raizUP: { id: 'root-1', titulo: 'T', criado_em: null }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }],
      lote: { origem: 'manual' },
    });
    const upArgs: Array<Record<string, unknown>> = [];
    const deps = baseDeps(admin, {
      atualizarUP: async (a): Promise<ResultadoAtualizarUP> => { upArgs.push(a as never); return { estado: 'ok', adicionadas: 1 }; },
    });
    await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(upArgs[0].preservarPublicadas).toBe(true);
  });

  it('lote normal (não-manual) não liga preservarPublicadas na rota UP', async () => {
    const { admin } = fakeAdmin({
      raizUP: { id: 'root-1', titulo: 'T', criado_em: null }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }],
    });
    const upArgs: Array<Record<string, unknown>> = [];
    const deps = baseDeps(admin, {
      atualizarUP: async (a): Promise<ResultadoAtualizarUP> => { upArgs.push(a as never); return { estado: 'ok', adicionadas: 0 }; },
    });
    await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(upArgs[0].preservarPublicadas).toBe(false);
  });

  it('fix round 1: rota UP com módulo fiscal ativo e cadastro completo → enfileira o push fiscal', async () => {
    const { admin } = fakeAdmin({
      familia: FAMILIA_FISCAL_OK, modulosHabilitados: ['fiscal'],
      raizUP: { id: 'root-1', titulo: 'AGULHA MATTE', criado_em: '2026-07-22T00:00:00Z' }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }],
    });
    const deps = baseDeps(admin, { atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'ok', adicionadas: 0 }) });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarFiscalSpy).toHaveBeenCalledWith(JOB.familia_id);
  });

  it('fix round 1: rota UP sem módulo fiscal → NÃO enfileira o push fiscal', async () => {
    const { admin } = fakeAdmin({
      familia: FAMILIA_FISCAL_OK, modulosHabilitados: [],
      raizUP: { id: 'root-1', titulo: 'AGULHA MATTE', criado_em: '2026-07-22T00:00:00Z' }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }],
    });
    const deps = baseDeps(admin, { atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'ok', adicionadas: 0 }) });
    const r = await processarAtualizacaoFamilia(deps, JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarFiscalSpy).not.toHaveBeenCalled();
  });

  it('UP retry (mudança de composição incompleta) → tipo retry, NÃO finaliza lote nem marca erro', async () => {
    const { admin, writes } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T' }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }] });
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
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T' }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }] });
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
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T' }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }] });
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

describe('pesoLiquidoGramas do kit vinculado no UPDATE (ADR-0151, bug MLB7585283770)', () => {
  // NET_WEIGHT ("Peso líquido") é atributo de categoria diferente de SELLER_PACKAGE_WEIGHT
  // (frete) — sem isto, corrigir peso_gramas no banco não bastava pra chegar no anúncio já
  // publicado: o UPDATE só reenviava BRAND + dimensões/peso do pacote, nunca o array geral de
  // atributos.
  const argsDoUpdate = () =>
    fakeConnector.chamadas.find((c) => c.metodo === 'atualizarAnuncio')?.args as { pesoLiquidoGramas?: number | null };

  it('família com kit_multiplicador e NET_WEIGHT herdado da base → reenvia = peso_gramas da variação (já é base×N)', async () => {
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, kit_multiplicador: 2, atributos_ml: [{ id: 'NET_WEIGHT', value_name: '700 g' }] },
      variacoes: [{ ...VAR_CASADA, peso_gramas: 1400 }],
    });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(argsDoUpdate().pesoLiquidoGramas).toBe(1400);
  });

  it('família SEM kit_multiplicador (produto normal) → pesoLiquidoGramas null, não mexe em NET_WEIGHT', async () => {
    const { admin } = fakeAdmin({ familia: { ...FAMILIA_BASE, kit_multiplicador: null } });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(argsDoUpdate().pesoLiquidoGramas).toBeNull();
  });

  it('kit numa categoria sem NET_WEIGHT (base nunca teve o atributo) → não inventa no UPDATE', async () => {
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, kit_multiplicador: 2, atributos_ml: [] },
      variacoes: [{ ...VAR_CASADA, peso_gramas: 1400 }],
    });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(argsDoUpdate().pesoLiquidoGramas).toBeNull();
  });
});

describe('UPDATE Legacy × kit com variação (ADR-0200)', () => {
  const skusSemQuantidade = () =>
    (fakeConnector.chamadas.find((c) => c.metodo === 'atualizarAnuncio')?.args as { skusSemQuantidade?: string[] }).skusSemQuantidade;

  it('SKU participante vai ao conector como sem quantidade', async () => {
    const { admin } = fakeAdmin({
      familia: { ...FAMILIA_BASE, organizations: { modulos_habilitados: ['kit_variacao'] } }, kitComponentes: ['V1'],
    });
    await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(skusSemQuantidade()).toEqual(['V1']);
  });

  it('org sem o módulo: lista vazia, comportamento de hoje', async () => {
    const { admin } = fakeAdmin({ kitComponentes: ['V1'] });
    await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(skusSemQuantidade()).toEqual([]);
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

describe('processarAtualizacaoFamilia — barreira do reajuste de preço em massa (spec C2)', () => {
  it('reajuste ativo no produto → erro definitivo, sem tocar o ML', async () => {
    const { admin, writes } = fakeAdmin({ reajusteAtivo: 'MLB-EXISTENTE' });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'erro', mensagem: 'Há reajuste de preço em massa em andamento neste produto (400)' });
    expect(fakeConnector.chamadas).toHaveLength(0);
    expect(writes.find((w) => w.table === 'familias' && w.payload.status === 'erro')?.payload.erro_mensagem)
      .toBe('Há reajuste de preço em massa em andamento neste produto (400)');
  });

  it('RPC falha → retry (fail-closed), sem tocar o ML nem marcar erro', async () => {
    const { admin, writes } = fakeAdmin({ reajusteErro: true });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'retry', mensagem: 'Falha ao conferir reajuste de preço em massa: timeout' });
    expect(fakeConnector.chamadas).toHaveLength(0);
    expect(writes.some((w) => w.table === 'familias' && w.payload.status === 'erro')).toBe(false);
  });
});

describe('BRAND do UPDATE legado pela marca do produto (ADR-0188)', () => {
  const marcaDoUpdate = () =>
    (fakeConnector.chamadas.find((c) => c.metodo === 'atualizarAnuncio')?.args as { marca?: string | null }).marca;

  it('produto com marca + fornecedor → envia a marca do produto, nunca o fornecedor', async () => {
    const { admin } = fakeAdmin({ familia: { ...FAMILIA_BASE, marca: 'Lacoste', fornecedor: 'STAR GLAMOUR' } });
    await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(marcaDoUpdate()).toBe('Lacoste');
  });

  it('produto com marca sem fornecedor → envia a marca', async () => {
    const { admin } = fakeAdmin({ familia: { ...FAMILIA_BASE, marca: 'Zaven', fornecedor: null } });
    await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(marcaDoUpdate()).toBe('Zaven');
  });

  it('sem marca e sem fornecedor → não envia BRAND (Avil, ADR-0016)', async () => {
    const { admin } = fakeAdmin({ familia: { ...FAMILIA_BASE, marca: null, fornecedor: null } });
    await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(marcaDoUpdate()).toBeNull();
  });

  it('sem marca e com fornecedor → envia o fornecedor (planilha, Avil)', async () => {
    const { admin } = fakeAdmin({ familia: { ...FAMILIA_BASE, marca: null, fornecedor: ' BUFALO ' } });
    await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(marcaDoUpdate()).toBe('BUFALO');
  });
});

describe('processarAtualizacaoFamilia — NCM fora da tabela oficial (ADR-0187)', () => {
  beforeEach(() => fakeConnector.reset());

  it('NCM vencido (org com módulo fiscal) → erro definitivo com a copy, zero chamadas ao ML', async () => {
    const { admin, writes } = fakeAdmin({ familia: FAMILIA_FISCAL_OK, modulosHabilitados: ['fiscal'], ncm: 'vencido' });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
    expect((r as { mensagem: string }).mensagem).toMatch(/NCM 39269090 não está mais vigente/);
    expect(fakeConnector.chamadas).toHaveLength(0);
    expect(writes.some((w) => w.table === 'familias' && w.payload.status === 'erro')).toBe(true);
  });

  it('erro lendo ncm_consultar → retry (transitório), zero chamadas ao ML, família não marcada erro', async () => {
    const { admin, writes } = fakeAdmin({ familia: FAMILIA_FISCAL_OK, modulosHabilitados: ['fiscal'], ncm: 'erro' });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('retry');
    expect(fakeConnector.chamadas).toHaveLength(0);
    expect(writes.some((w) => w.table === 'familias' && w.payload.status === 'erro')).toBe(false);
  });
});

describe('processarAtualizacaoFamilia — somente estoque Legacy com cor nova (C2, auditoria fiscal 19/10)', () => {
  const VAR_NOVA = { ...VAR_CASADA, codigo: 'V2', cor: 'Verde', ml_picture_id: 'PIC2', ml_variation_id: null };

  it('cor nova + fiscal incompleto → erro do gate, ML não chamado', async () => {
    const { admin } = fakeAdmin({ variacoes: [{ ...VAR_CASADA }, { ...VAR_NOVA }], modulosHabilitados: ['fiscal'] });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), { ...JOB, somenteEstoque: true }, { tentativas: 0 });
    expect(r.tipo).toBe('erro');
    expect((r as { mensagem: string }).mensagem).toMatch(/Cadastro fiscal incompleto/);
    expect(fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarAnuncio')).toHaveLength(0);
  });

  it('cor nova + fiscal completo → sucesso e enfileira o push fiscal', async () => {
    const { admin } = fakeAdmin({ familia: FAMILIA_FISCAL_OK, variacoes: [{ ...VAR_CASADA }, { ...VAR_NOVA }], modulosHabilitados: ['fiscal'] });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), { ...JOB, somenteEstoque: true }, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarFiscalSpy).toHaveBeenCalledWith(JOB.familia_id);
  });

  it('sem cor nova (reposição pura) → gate não consultado e push NÃO enfileirado', async () => {
    const { admin } = fakeAdmin({ variacoes: [{ ...VAR_CASADA }], modulosHabilitados: ['fiscal'] });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), { ...JOB, somenteEstoque: true }, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(enfileirarFiscalSpy).not.toHaveBeenCalled();
  });
});

// ADR-0201 Task 14 — trava de escrita por MLB: o escritor trava ANTES do GET em que baseia o PUT, adia sem escrever em
// conflito e só solta com resposta definitiva do ML.
describe('UPDATE Legacy × trava de escrita da galeria (ADR-0201)', () => {
  const VAR_NOVA = { ...VAR_CASADA, codigo: 'V2', cor: 'Rosa', ml_variation_id: null, ml_picture_id: 'PIC2' };
  const chamadasConector = () => fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarAnuncio' || c.metodo === 'subirFoto');

  it('item travado → nenhum GET nem PUT, resultado adiado (HTTP 200), família continua publicando', async () => {
    const { admin, writes } = fakeAdmin();
    const reservar = vi.fn(async () => ({ tipo: 'adiada' as const, adiadaId: 'ad1' }));
    const r = await processarAtualizacaoFamilia(baseDeps(admin, { reservar }), JOB, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'adiado' });
    expect(reservar).toHaveBeenCalledWith(admin, expect.objectContaining({
      orgId: 'org-1', familiaId: 'fam-1', loteId: 'lote-1', endpoint: 'update-familia-ml', itens: ['MLB-EXISTENTE'],
    }));
    expect(chamadasConector()).toHaveLength(0);
    expect(writes.filter((w) => w.table === 'familias' && 'status' in w.payload)).toHaveLength(0);
  });

  it('falha ao gravar o adiamento → retry (5xx; a mensagem original repete), nada no ML, sem erro gravado', async () => {
    const { admin, writes } = fakeAdmin();
    const r = await processarAtualizacaoFamilia(baseDeps(admin, { reservar: async () => { throw new Error('gravar escrita adiada: boom'); } }), JOB, { tentativas: 9 });
    expect(r.tipo).toBe('retry');
    expect(chamadasConector()).toHaveLength(0);
    expect(writes.filter((w) => w.table === 'familias' && 'status' in w.payload)).toHaveLength(0);
  });

  it('linha adiada assumida por outro job vivo → skip sem escrever', async () => {
    const { admin } = fakeAdmin();
    const r = await processarAtualizacaoFamilia(baseDeps(admin, { reservar: async () => ({ tipo: 'assumida' as const }) }),
      { ...JOB, adiada_id: 'ad1' }, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'skip', status: 'adiada_assumida' });
    expect(chamadasConector()).toHaveLength(0);
  });

  it('somenteEstoque sem cor nova → dispensado da trava (não reserva, PUT sai, sem gancho)', async () => {
    const { admin } = fakeAdmin();
    const reservar = vi.fn();
    const r = await processarAtualizacaoFamilia(baseDeps(admin, { reservar }), { ...JOB, somenteEstoque: true }, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(reservar).not.toHaveBeenCalled();
    const a = fakeConnector.chamadas.find((c) => c.metodo === 'atualizarAnuncio')!.args as { antesDoPut?: unknown };
    expect(a.antesDoPut).toBeUndefined();
  });

  it('somenteEstoque COM cor nova (criandoNovas) em item reservado → adiado', async () => {
    const { admin } = fakeAdmin({ variacoes: [{ ...VAR_CASADA }, VAR_NOVA] });
    const reservar = vi.fn(async () => ({ tipo: 'adiada' as const, adiadaId: 'ad1' }));
    const r = await processarAtualizacaoFamilia(baseDeps(admin, { reservar }), { ...JOB, somenteEstoque: true }, { tentativas: 0 });
    expect(r).toEqual({ tipo: 'adiado' });
    expect(chamadasConector()).toHaveLength(0);
  });

  it('família UP (rodarUP) com item travado → não é adiada (só price/quantity/attributes)', async () => {
    const { admin } = fakeAdmin({ raizUP: { id: 'root-1', titulo: 'T', criado_em: '2026-07-22T00:00:00Z' }, itensUP: [{ id: 'it-1', item_externo_id: 'MLB-IT1' }] });
    const reservar = vi.fn(async () => ({ tipo: 'adiada' as const, adiadaId: 'ad1' }));
    const r = await processarAtualizacaoFamilia(baseDeps(admin, { reservar,
      atualizarUP: async (): Promise<ResultadoAtualizarUP> => ({ estado: 'ok', adicionadas: 0 }) }), JOB, { tentativas: 0 });
    expect(r.tipo).toBe('ok');
    expect(reservar).not.toHaveBeenCalled();
  });

  it('livre: o conector recebe antesDoPut (estende 900 s) e a trava é solta com 2xx', async () => {
    const { admin, rpcs } = fakeAdmin();
    const spy = vi.spyOn(fakeConnector, 'atualizarAnuncio').mockImplementation(async (_c, a) => {
      expect(await a.antesDoPut!()).toBe(true);
      return { ok: true, valor: { variacoesExternas: {}, precoVivo: null } };
    });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    spy.mockRestore();
    expect(r.tipo).toBe('ok');
    expect(rpcs.map((x) => x.fn)).toEqual(expect.arrayContaining(['ml_estender_trava', 'ml_soltar_itens']));
    expect(rpcs.find((x) => x.fn === 'ml_estender_trava')!.args).toMatchObject({ p_itens: ['MLB-EXISTENTE'], p_dono: 'dono-job', p_seg: 900 });
  });

  it('PUT sem resposta (timeout, sem status) → retry e a trava NÃO é solta', async () => {
    const { admin, rpcs } = fakeAdmin();
    const spy = vi.spyOn(fakeConnector, 'atualizarAnuncio').mockImplementation(async (_c, a) => {
      await a.antesDoPut!();
      return { ok: false, erro: { codigo: 'DESCONHECIDO', mensagemOperador: 'timeout', retentavel: true } };
    });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    spy.mockRestore();
    expect(r.tipo).toBe('retry');
    expect(rpcs.some((x) => x.fn === 'ml_soltar_itens')).toBe(false);
  });

  it('resposta 4xx definitiva → solta a trava', async () => {
    const { admin, rpcs } = fakeAdmin();
    const spy = vi.spyOn(fakeConnector, 'atualizarAnuncio').mockImplementation(async (_c, a) => {
      await a.antesDoPut!();
      return { ok: false, erro: { codigo: 'ATRIBUTO', mensagemOperador: 'recusado', retentavel: false, status: 400 } };
    });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    spy.mockRestore();
    expect(r.tipo).toBe('erro');
    expect(rpcs.some((x) => x.fn === 'ml_soltar_itens')).toBe(true);
  });

  it('extensão recusada antes do PUT → o conector não envia e a trava é solta (nenhum PUT saiu)', async () => {
    const { admin, rpcs } = fakeAdmin({ estender: false });
    let enviou = false;
    const spy = vi.spyOn(fakeConnector, 'atualizarAnuncio').mockImplementation(async (_c, a) => {
      if (!(await a.antesDoPut!())) return { ok: false, erro: { codigo: 'DESCONHECIDO', mensagemOperador: 'trava', retentavel: false, status: 409 } };
      enviou = true;
      return { ok: true, valor: { variacoesExternas: {}, precoVivo: null } };
    });
    const r = await processarAtualizacaoFamilia(baseDeps(admin), JOB, { tentativas: 0 });
    spy.mockRestore();
    expect(enviou).toBe(false);
    expect(r.tipo).toBe('erro');
    expect(rpcs.some((x) => x.fn === 'ml_soltar_itens')).toBe(true);
  });
});
