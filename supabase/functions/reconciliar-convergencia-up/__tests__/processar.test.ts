import { describe, it, expect, vi } from 'vitest';

// Cadeia real (ml/token.ts → _shared/supabase.ts; queue.ts → npm:qstash; notificacoes/config.ts)
// puxa jsr/npm/Deno — mockada pro vitest (mesmo padrão de
// atualizar-familia-up/__tests__ e update-familia-ml/__tests__/processar.test.ts).
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));
vi.mock('../../_shared/queue.ts', () => ({ enfileirarVinculacaoCatalogo: vi.fn() }));
const notificarCategoriaMock = vi.hoisted(() => vi.fn());
vi.mock('../../_shared/notificacoes/config.ts', () => ({ notificarCategoria: notificarCategoriaMock }));

// atualizarFamiliaUP é a saga real (exaustivamente testada em atualizar-familia-up.test.ts) —
// mockada aqui pra isolar SÓ a rede de segurança deste adapter (achado real, revisão adversarial
// 3ª rodada: o UPDATE de limpeza engolia o próprio erro com console.error, reportando 'convergiu'
// com a raiz ainda travada em mudando_composicao=true).
const atualizarFamiliaUPMock = vi.hoisted(() => vi.fn());
vi.mock('../../_shared/user-products/atualizar-familia-up.ts', () => ({ atualizarFamiliaUP: atualizarFamiliaUPMock }));
const recusasPorOfertaMock = vi.hoisted(() => vi.fn(async (): Promise<{ familia_id: string; motivo: string }[]> => []));
vi.mock('../../_shared/publicacao/trava-oferta.ts', async (original) => ({
  ...(await original<typeof import('../../_shared/publicacao/trava-oferta.ts')>()),
  recusasPorOferta: recusasPorOfertaMock,
}));

// Fechamento do lote lê e grava `lotes`/`familias`; aqui só importa que a recusa terminal o chame.
const talvezFinalizarLoteMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../_shared/lote/finalizar.ts', () => ({ talvezFinalizarLote: talvezFinalizarLoteMock }));

import { criarPortasConvergencia, listarRaizesTravadas } from '../processar';
import { reconciliarConvergencia } from '../../_shared/user-products/reconciliar-convergencia';

// Fake admin: fila FIFO por tabela + interceptação de rpc(). Cobre os 2 achados críticos da
// revisão adversarial (2ª rodada): (1) guard de SKU sem dado fonte falha ANTES de qualquer
// mutação remota — nem chega a resolver conexão/token; (2) família não encontrada (referenciada
// pela raiz mas já apagada) falha com mensagem clara, não crasha ambíguo.
// `updateErros`: marca `{tabela}` cuja PRÓXIMA chamada a `update()` deve resolver `{error}`.
// `leituraErros`: `{tabela}` cujo `maybeSingle()` resolve `{error}` (ex.: ler a origem do lote).
function fakeAdmin(
  filas: Record<string, unknown[]> = {}, rpcs: Record<string, unknown> = {},
  updateErros: Record<string, string> = {}, leituraErros: Record<string, string> = {},
) {
  const updates: { tabela: string; payload: Record<string, unknown> }[] = [];
  const nots: unknown[][] = [];
  const proximo = (tabela: string) => {
    const fila = filas[tabela] ?? [];
    return fila.length ? fila.shift() : [];
  };
  function chain(tabela: string): any {
    const obj: any = {
      select: () => obj,
      eq: () => obj,
      lt: () => obj,
      not: (...args: unknown[]) => { nots.push(args); return obj; },
      maybeSingle: async () => (leituraErros[tabela]
        ? { data: null, error: { message: leituraErros[tabela] } }
        : { data: proximo(tabela), error: null }),
      update: (payload: Record<string, unknown>) => {
        updates.push({ tabela, payload });
        const erro = updateErros[tabela];
        return { eq: async () => ({ error: erro ? { message: erro } : null }) };
      },
      then: (resolve: any) => Promise.resolve({ data: proximo(tabela), error: null }).then(resolve),
    };
    return obj;
  }
  const admin: any = {
    from: (tabela: string) => chain(tabela),
    rpc: async (nome: string, args: Record<string, unknown>) => ({ data: (rpcs[nome] as (a: unknown) => unknown)?.(args) ?? null, error: null }),
  };
  return { admin, updates, nots };
}

const FAMILIA_OK = { id: 'fam-1', org_id: 'org-1', codigo_pai: '00012345', lote_id: 'lote-1' };
const LOTE_PLANILHA = { origem: 'planilha' };
const VARIACOES_OK = [{ codigo: 'A' }, { codigo: 'B' }];
const CONEXAO_OK = { id: 'conn-1', org_id: 'org-1', canal: 'mercado_livre', conta_externa_id: 'seller-1', expires_at: null };
const CLAIM_OK = {
  rootId: 'root-1', orgId: 'org-1', codigoPai: '00012345', titulo: 'Fam UP', criadoEm: '2026-01-01T00:00:00Z',
  skusEsperados: ['A', 'B'], familiaId: 'fam-1', tentativas: 0,
};

const CLAIM_ROW = {
  org_id: 'org-1', codigo_pai: '00012345', titulo: 'Fam UP', criado_em: '2026-01-01T00:00:00Z',
  skus_esperados: ['A', 'B'], mudando_composicao_familia_id: 'fam-1', reconciliacao_tentativas: 4,
};

describe('listarRaizesTravadas', () => {
  it('lista os ids das raízes retornadas pela query', async () => {
    const { admin } = fakeAdmin({ anuncios_externos: [[{ id: 'root-1' }, { id: 'root-2' }]] });
    const ids = await listarRaizesTravadas({ admin, orgsArquivadas: new Set() }, '2026-01-01T00:00:00Z');
    expect(ids).toEqual(['root-1', 'root-2']);
  });

  it('exclui orgs arquivadas na consulta (not.in)', async () => {
    const { admin, nots } = fakeAdmin({ anuncios_externos: [[{ id: 'root-1' }]] });
    await listarRaizesTravadas({ admin, orgsArquivadas: new Set(['org-x', 'org-y']) }, '2026-01-01T00:00:00Z');
    expect(nots).toEqual([['org_id', 'in', '(org-x,org-y)']]);
  });

  it('sem arquivadas não aplica not.in', async () => {
    const { admin, nots } = fakeAdmin({ anuncios_externos: [[]] });
    await listarRaizesTravadas({ admin, orgsArquivadas: new Set() }, '2026-01-01T00:00:00Z');
    expect(nots).toEqual([]);
  });

  it('erro na query → lança (fail-closed)', async () => {
    const { admin } = fakeAdmin();
    admin.from = () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ lt: async () => ({ data: null, error: { message: 'timeout' } }) }) }) }) }) });
    await expect(listarRaizesTravadas({ admin, orgsArquivadas: new Set() }, '2026-01-01T00:00:00Z')).rejects.toThrow(/timeout/);
  });
});

describe('criarPortasConvergencia — claim', () => {
  it('RPC retorna vazio → claim() devolve null (perdeu o claim)', async () => {
    const { admin } = fakeAdmin({}, { reconciliar_convergencia_claim: () => [] });
    const portas = criarPortasConvergencia(admin, '2026-01-01T00:00:00Z');
    expect(await portas.claim('root-1')).toBeNull();
  });

  it('RPC retorna a linha → claim() mapeia todos os campos corretamente', async () => {
    const { admin } = fakeAdmin({}, { reconciliar_convergencia_claim: () => [CLAIM_ROW] });
    const portas = criarPortasConvergencia(admin, '2026-01-01T00:00:00Z');
    const claim = await portas.claim('root-1');
    expect(claim).toEqual({
      rootId: 'root-1', orgId: 'org-1', codigoPai: '00012345', titulo: 'Fam UP',
      criadoEm: '2026-01-01T00:00:00Z', skusEsperados: ['A', 'B'], familiaId: 'fam-1', tentativas: 4,
    });
  });
});

describe('criarPortasConvergencia — resumirComposicao (guards, antes de tocar o ML)', () => {
  it('família referenciada pela raiz não existe mais (já apagada) → lança mensagem clara', async () => {
    const { admin } = fakeAdmin({ familias: [null] });
    const portas = criarPortasConvergencia(admin, '2026-01-01T00:00:00Z');
    await expect(portas.resumirComposicao({
      rootId: 'root-1', orgId: 'org-1', codigoPai: '00012345', titulo: null, criadoEm: null,
      skusEsperados: ['A'], familiaId: 'fam-apagada', tentativas: 0,
    })).rejects.toThrow(/fam-apagada.*não encontrada/);
  });

  it('SKU esperado sem dado fonte em variações → lança ANTES de resolver conexão/token (nunca zera estoque)', async () => {
    const { admin } = fakeAdmin({
      familias: [{ id: 'fam-1', org_id: 'org-1', codigo_pai: '00012345' }],
      variacoes: [[{ codigo: 'A' }]], // só tem A — B esperado mas ausente
    });
    const portas = criarPortasConvergencia(admin, '2026-01-01T00:00:00Z');
    await expect(portas.resumirComposicao({
      rootId: 'root-1', orgId: 'org-1', codigoPai: '00012345', titulo: null, criadoEm: null,
      skusEsperados: ['A', 'B'], familiaId: 'fam-1', tentativas: 0,
    })).rejects.toThrow(/SKU\(s\) B esperado/);
  });

  it('todos os SKUs esperados têm dado fonte em variações → NÃO lança pelo guard (segue adiante)', async () => {
    const { admin } = fakeAdmin({
      familias: [{ id: 'fam-1', org_id: 'org-1', codigo_pai: '00012345' }],
      variacoes: [[{ codigo: 'A' }, { codigo: 'B' }]],
      lotes: [LOTE_PLANILHA],
      marketplace_connections: [null], // sem conexão — falha depois do guard, prova que passou dele
    });
    const portas = criarPortasConvergencia(admin, '2026-01-01T00:00:00Z');
    await expect(portas.resumirComposicao({
      rootId: 'root-1', orgId: 'org-1', codigoPai: '00012345', titulo: null, criadoEm: null,
      skusEsperados: ['A', 'B'], familiaId: 'fam-1', tentativas: 0,
    })).rejects.toThrow(/sem conexão com o Mercado Livre/); // passou do guard de SKU, falhou no passo seguinte
  });
});

describe('criarPortasConvergencia — resumirComposicao (rede de segurança do sem_mudanca)', () => {
  it("atualizarFamiliaUP retorna estado:'ok' → dispara UPDATE zerando mudando_composicao/reconciliacao_tentativas/mudando_composicao_familia_id na raiz", async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'ok' });
    const { admin, updates } = fakeAdmin({
      familias: [FAMILIA_OK], variacoes: [VARIACOES_OK], lotes: [LOTE_PLANILHA], marketplace_connections: [CONEXAO_OK],
    });
    const portas = criarPortasConvergencia(admin, '2026-01-01T00:00:00Z');
    const resultado = await portas.resumirComposicao(CLAIM_OK);
    expect(resultado).toEqual({ estado: 'ok' });
    expect(updates).toContainEqual({
      tabela: 'anuncios_externos',
      payload: { mudando_composicao: false, reconciliacao_tentativas: 0, mudando_composicao_familia_id: null },
    });
  });

  it('UPDATE de limpeza falha → lança (nunca reporta convergência falsa com a raiz ainda travada)', async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'ok' });
    const { admin } = fakeAdmin(
      { familias: [FAMILIA_OK], variacoes: [VARIACOES_OK], lotes: [LOTE_PLANILHA], marketplace_connections: [CONEXAO_OK] },
      {},
      { anuncios_externos: 'timeout' },
    );
    const portas = criarPortasConvergencia(admin, '2026-01-01T00:00:00Z');
    await expect(portas.resumirComposicao(CLAIM_OK)).rejects.toThrow(/limpeza de segurança falhou.*timeout/);
  });

  it("atualizarFamiliaUP retorna estado:'retry' → NÃO dispara a limpeza (raiz segue travada de propósito, ainda incompleta)", async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'retry' });
    const { admin, updates } = fakeAdmin({
      familias: [FAMILIA_OK], variacoes: [VARIACOES_OK], lotes: [LOTE_PLANILHA], marketplace_connections: [CONEXAO_OK],
    });
    const portas = criarPortasConvergencia(admin, '2026-01-01T00:00:00Z');
    const resultado = await portas.resumirComposicao(CLAIM_OK);
    expect(resultado).toEqual({ estado: 'retry' });
    expect(updates.some((u) => u.tabela === 'anuncios_externos')).toBe(false);
  });
});

describe('criarPortasConvergencia — resumirComposicao (trava da oferta)', () => {
  const MOTIVO = 'Preço igual ou abaixo da oferta de R$ 80,00 — ajuste a oferta antes';
  const INCONCLUSIVA = 'Não foi possível conferir promoções — tente de novo';
  const filas = (lote: unknown = LOTE_PLANILHA) => ({
    familias: [FAMILIA_OK], lotes: [lote], marketplace_connections: [CONEXAO_OK],
    variacoes: [[{ codigo: 'A', preco_publicacao: 70 }, { codigo: 'B', preco_publicacao: '90.00' }, { codigo: 'FORA', preco_publicacao: 1 }]],
    anuncios_externos_itens: [[
      { sku: 'A', item_externo_id: 'MLB1' }, { sku: 'B', item_externo_id: 'MLB2' }, { sku: 'FORA', item_externo_id: 'MLB3' },
    ]],
  });
  const resumir = (admin: unknown) => criarPortasConvergencia(admin as never, '2026-01-01T00:00:00Z').resumirComposicao(CLAIM_OK);
  const semErros = (updates: { tabela: string }[]) => updates.filter((u) => u.tabela === 'familias');

  it('confere um alvo por SKU esperado, com o preço da própria cor', async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'ok' });
    recusasPorOfertaMock.mockReset().mockResolvedValueOnce([]);
    await resumir(fakeAdmin(filas()).admin);
    expect(recusasPorOfertaMock.mock.calls[0]![0 as never]).toEqual([
      { familia_id: 'A', itens: [{ ml_item_id: 'MLB1', preco: 70 }] },
      { familia_id: 'B', itens: [{ ml_item_id: 'MLB2', preco: 90 }] },
    ]);
  });

  it('alvo aprovado → comportamento atual: saga sem semPrecoPara e nada gravado em familias', async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'ok' });
    recusasPorOfertaMock.mockReset().mockResolvedValueOnce([]);
    const { admin, updates } = fakeAdmin(filas());
    expect(await resumir(admin)).toEqual({ estado: 'ok' });
    expect(atualizarFamiliaUPMock.mock.calls[0]![0].semPrecoPara).toEqual([]);
    expect(semErros(updates)).toEqual([]);
  });

  it('reprovado ou inconclusivo → saga com semPrecoPara, composição concluída e motivo em familias', async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'ok' });
    recusasPorOfertaMock.mockReset().mockResolvedValueOnce([{ familia_id: 'A', motivo: MOTIVO }, { familia_id: 'B', motivo: INCONCLUSIVA }]);
    const { admin, updates } = fakeAdmin(filas());
    expect(await resumir(admin)).toEqual({ estado: 'ok' });
    expect(atualizarFamiliaUPMock.mock.calls[0]![0].semPrecoPara).toEqual(['A', 'B']);
    expect(updates).toContainEqual({
      tabela: 'anuncios_externos',
      payload: { mudando_composicao: false, reconciliacao_tentativas: 0, mudando_composicao_familia_id: null },
    });
    expect(semErros(updates)).toEqual([{
      tabela: 'familias', payload: { erro_mensagem: `Preço não enviado (A, B): ${MOTIVO}; ${INCONCLUSIVA}` },
    }]);
  });

  it('reprovado avisa o operador no app, com produto e oferta, uma vez por família e rodada', async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'ok' });
    recusasPorOfertaMock.mockReset().mockResolvedValueOnce([{ familia_id: 'A', motivo: MOTIVO }]);
    notificarCategoriaMock.mockReset();
    const f = { ...filas(), familias: [{ ...FAMILIA_OK, nome_pai: 'Tênis Azul' }] };
    await resumir(fakeAdmin(f).admin);
    expect(notificarCategoriaMock).toHaveBeenCalledTimes(1);
    expect(notificarCategoriaMock.mock.calls[0]!.slice(1)).toEqual([
      'org-1', 'integracao', `⚠️ Preço mantido no Mercado Livre: Tênis Azul\nCores A: ${MOTIVO}`, { chave: 'trava-oferta:fam-1:0' },
    ]);
  });

  it('falha ao avisar não desfaz a convergência', async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'ok' });
    recusasPorOfertaMock.mockReset().mockResolvedValueOnce([{ familia_id: 'A', motivo: MOTIVO }]);
    notificarCategoriaMock.mockReset().mockRejectedValueOnce(new Error('sem rede'));
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await resumir(fakeAdmin(filas()).admin)).toEqual({ estado: 'ok' });
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it('sem recusa não avisa', async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'ok' });
    recusasPorOfertaMock.mockReset().mockResolvedValueOnce([]);
    notificarCategoriaMock.mockReset();
    await resumir(fakeAdmin(filas()).admin);
    expect(notificarCategoriaMock).not.toHaveBeenCalled();
  });

  it('saga sem convergir não grava nem avisa: a próxima rodada confere de novo', async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'retry' });
    recusasPorOfertaMock.mockReset().mockResolvedValueOnce([{ familia_id: 'A', motivo: MOTIVO }]);
    notificarCategoriaMock.mockReset();
    const { admin, updates } = fakeAdmin(filas());
    await resumir(admin);
    expect(semErros(updates)).toEqual([]);
    expect(notificarCategoriaMock).not.toHaveBeenCalled();
  });

  it('fluxo Adicionar variação confere só quem recebe preço: filho ativo é preservado', async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'ok' });
    recusasPorOfertaMock.mockReset().mockResolvedValueOnce([{ familia_id: 'B', motivo: MOTIVO }]);
    const f = {
      ...filas({ origem: 'manual' }),
      anuncios_externos_itens: [[
        { sku: 'A', item_externo_id: 'MLB1', status: 'ativo', retirado: false },
        { sku: 'B', item_externo_id: 'MLB2', status: 'pausado', retirado: true },
      ]],
    };
    await resumir(fakeAdmin(f).admin);
    expect(recusasPorOfertaMock.mock.calls[0]![0 as never]).toEqual([{ familia_id: 'B', itens: [{ ml_item_id: 'MLB2', preco: 90 }] }]);
    expect(atualizarFamiliaUPMock.mock.calls[0]![0].semPrecoPara).toEqual(['B']);
  });

  describe('orçamento único da rodada', () => {
    const aguardar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

    it('o orçamento de cada raiz é o que sobrou da rodada, no máximo 20 s', async () => {
      atualizarFamiliaUPMock.mockReset().mockResolvedValue({ estado: 'ok' });
      recusasPorOfertaMock.mockReset().mockResolvedValue([]);
      await criarPortasConvergencia(fakeAdmin(filas()).admin, 'x').resumirComposicao(CLAIM_OK);
      expect(recusasPorOfertaMock.mock.calls[0]![2 as never]).toBe(20_000);

      recusasPorOfertaMock.mockClear();
      await criarPortasConvergencia(fakeAdmin(filas()).admin, 'x', 500).resumirComposicao(CLAIM_OK);
      expect(recusasPorOfertaMock.mock.calls[0]![2 as never]).toBe(500);
    });

    it('o tempo gasto nas checagens acumula entre as raízes e esgota a rodada', async () => {
      atualizarFamiliaUPMock.mockReset().mockResolvedValue({ estado: 'ok' });
      recusasPorOfertaMock.mockReset().mockImplementation(async () => { await aguardar(30); return []; });
      const { admin } = fakeAdmin({ ...filas(), familias: [FAMILIA_OK, FAMILIA_OK], lotes: [LOTE_PLANILHA, LOTE_PLANILHA],
        marketplace_connections: [CONEXAO_OK, CONEXAO_OK], variacoes: [filas().variacoes[0], filas().variacoes[0]],
        anuncios_externos_itens: [filas().anuncios_externos_itens[0], filas().anuncios_externos_itens[0]] });
      const portas = criarPortasConvergencia(admin, 'x', 50);
      expect(portas.orcamentoEsgotado!()).toBe(false);
      await portas.resumirComposicao(CLAIM_OK);
      expect(portas.orcamentoEsgotado!()).toBe(false);
      await portas.resumirComposicao(CLAIM_OK);
      expect(portas.orcamentoEsgotado!()).toBe(true);
    });

    it('raiz sem nada a conferir não gasta orçamento', async () => {
      atualizarFamiliaUPMock.mockReset().mockResolvedValue({ estado: 'ok' });
      recusasPorOfertaMock.mockReset().mockImplementation(async () => { await aguardar(20); return []; });
      const portas = criarPortasConvergencia(fakeAdmin({ ...filas(), anuncios_externos_itens: [[]] }).admin, 'x', 5);
      await portas.resumirComposicao(CLAIM_OK);
      expect(recusasPorOfertaMock).not.toHaveBeenCalled();
      expect(portas.orcamentoEsgotado!()).toBe(false);
    });
  });
});

describe('criarPortasConvergencia — resumirComposicao (preservarPublicadas, Codex #1)', () => {
  const filas = (lote: unknown) => ({
    familias: [FAMILIA_OK], variacoes: [VARIACOES_OK], lotes: [lote], marketplace_connections: [CONEXAO_OK],
  });

  it("lote origem='manual' (fluxo Adicionar variação) → atualizarFamiliaUP recebe preservarPublicadas: true", async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'retry' });
    const { admin } = fakeAdmin(filas({ origem: 'manual' }));
    await criarPortasConvergencia(admin, '2026-01-01T00:00:00Z').resumirComposicao(CLAIM_OK);
    expect(atualizarFamiliaUPMock.mock.calls[0]![0].preservarPublicadas).toBe(true);
  });

  // Incidente 12/11/2026: a retomada também chama a saga com preservarPublicadas — mesma recusa do worker.
  describe('lote manual com cor desmarcada viva no ML', () => {
    const MENSAGEM = "UPDATE bloqueado: 1 cor(es) desmarcada(s) já publicada(s) no Mercado Livre (X). Em 'Adicionar variação' "
      + 'nenhuma cor pode ser desmarcada. Nada foi enviado. Marque todas as cores e reenvie.';
    const X_DESMARCADA = { codigo: 'X', ml_variation_id: null, excluida_da_publicacao: true };
    const X_VIVA = [{ sku: 'X', item_externo_id: 'MLB9', retirado: false }];
    const LIMPA = { mudando_composicao: false, reconciliacao_tentativas: 0, mudando_composicao_familia_id: null };
    const filasRecusa = (variacoes: unknown[]) => ({
      ...filas({ origem: 'manual' }), variacoes, anuncios_externos_itens: [X_VIVA],
    });
    const resumir = (admin: unknown) => criarPortasConvergencia(admin as never, '2026-01-01T00:00:00Z').resumirComposicao(CLAIM_OK);

    it('recusa com estado terminal: família em erro com a mensagem do worker, lote finalizado, saga não chamada', async () => {
      atualizarFamiliaUPMock.mockReset();
      talvezFinalizarLoteMock.mockClear();
      const { admin, updates } = fakeAdmin(filasRecusa([[...VARIACOES_OK, X_DESMARCADA]]));
      await expect(resumir(admin)).resolves.toEqual({ estado: 'erro' });
      expect(atualizarFamiliaUPMock).not.toHaveBeenCalled();
      // Mesmo desfecho do `incompleto` esgotado: erro visível na família e a raiz fora da seleção do reconciliador.
      expect(updates).toEqual([
        { tabela: 'familias', payload: { status: 'erro', erro_mensagem: MENSAGEM } },
        { tabela: 'anuncios_externos', payload: LIMPA },
      ]);
      expect(talvezFinalizarLoteMock).toHaveBeenCalledWith(admin, 'lote-1');
    });

    // Revisão do 6d15890f: incluídas e desmarcadas saem da MESMA leitura. Se a cor é remarcada depois, a
    // decisão continua sendo a da fotografia que a saga receberia.
    it('cor remarcada entre duas leituras: decide pela 1ª fotografia e não relê as variações', async () => {
      atualizarFamiliaUPMock.mockReset();
      const filasDuas = filasRecusa([[...VARIACOES_OK, X_DESMARCADA], [...VARIACOES_OK, { ...X_DESMARCADA, excluida_da_publicacao: false }]]);
      const { admin } = fakeAdmin(filasDuas);
      await expect(resumir(admin)).resolves.toEqual({ estado: 'erro' });
      expect(atualizarFamiliaUPMock).not.toHaveBeenCalled();
      expect(filasDuas.variacoes).toHaveLength(1); // a 2ª fotografia nunca foi lida
    });

    // A cor desmarcada que ESTAVA no snapshot esperado também fica "sem dado fonte". Essa checagem lança e
    // deixaria a raiz presa para sempre; a recusa terminal tem que vir antes.
    it('desmarcada que também era esperada pela composição: recusa terminal, não o throw de "sem dado fonte"', async () => {
      atualizarFamiliaUPMock.mockReset();
      const { admin, updates } = fakeAdmin(filasRecusa([[...VARIACOES_OK, X_DESMARCADA]]));
      const claim = { ...CLAIM_OK, skusEsperados: ['A', 'B', 'X'] };
      await expect(criarPortasConvergencia(admin, '2026-01-01T00:00:00Z').resumirComposicao(claim)).resolves.toEqual({ estado: 'erro' });
      expect(updates).toContainEqual({ tabela: 'anuncios_externos', payload: LIMPA });
    });

    it('a cor desmarcada nunca entra nas variações entregues à saga (controle: desmarcada fora do ar)', async () => {
      atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'retry' });
      const { admin } = fakeAdmin({ ...filasRecusa([[...VARIACOES_OK, X_DESMARCADA]]), anuncios_externos_itens: [[], []] });
      await expect(resumir(admin)).resolves.toEqual({ estado: 'retry' });
      expect(atualizarFamiliaUPMock.mock.calls[0]![0].variacoes).toEqual(VARIACOES_OK);
    });

    it('falha ao gravar o erro da família → lança e NÃO solta a raiz (a próxima rodada recusa de novo)', async () => {
      atualizarFamiliaUPMock.mockReset();
      const { admin, updates } = fakeAdmin(filasRecusa([[...VARIACOES_OK, X_DESMARCADA]]), {}, { familias: 'timeout' });
      await expect(resumir(admin)).rejects.toThrow(/gravar erro da família.*timeout/);
      expect(updates.some((u) => u.tabela === 'anuncios_externos')).toBe(false);
    });

    it('falha ao soltar a raiz → lança (nunca reporta desfecho terminal com a raiz ainda travada)', async () => {
      atualizarFamiliaUPMock.mockReset();
      const { admin } = fakeAdmin(filasRecusa([[...VARIACOES_OK, X_DESMARCADA]]), {}, { anuncios_externos: 'timeout' });
      await expect(resumir(admin)).rejects.toThrow(/soltar a raiz.*timeout/);
    });

    it('rodada seguinte: a raiz recusada não é mais reclamada, e as outras raízes seguem', async () => {
      // Raiz presa = `mudando_composicao=true`, a mesma condição da listagem e da RPC de claim.
      const presas = new Set(['root-recusada', 'root-ok']);
      const claimRpc = (a: { p_root_id: string }) => (presas.has(a.p_root_id) ? [{ ...CLAIM_ROW, reconciliacao_tentativas: 1 }] : []);
      const rodada = async (filasDaRodada: Record<string, unknown[]>) => {
        const { admin, updates } = fakeAdmin(filasDaRodada, { reconciliar_convergencia_claim: claimRpc as never });
        const portas = criarPortasConvergencia(admin, '2026-01-01T00:00:00Z');
        const resultados = [];
        for (const id of [...presas]) {
          const antes = updates.length;
          resultados.push(...await reconciliarConvergencia(portas, [id]));
          // Aplica no "banco" o que a rodada gravou nesta raiz.
          if (updates.slice(antes).some((u) => u.tabela === 'anuncios_externos' && u.payload.mudando_composicao === false)) presas.delete(id);
        }
        return resultados;
      };
      atualizarFamiliaUPMock.mockReset().mockResolvedValue({ estado: 'retry' });

      const primeira = await rodada({
        familias: [FAMILIA_OK, FAMILIA_OK], marketplace_connections: [CONEXAO_OK],
        lotes: [{ origem: 'manual' }, LOTE_PLANILHA],
        variacoes: [[...VARIACOES_OK, X_DESMARCADA], VARIACOES_OK],
        anuncios_externos_itens: [X_VIVA, []],
      });
      expect(primeira.map((r) => r.tipo)).toEqual(['erro', 'retry']);
      expect([...presas]).toEqual(['root-ok']);

      atualizarFamiliaUPMock.mockClear();
      const segunda = await rodada({
        familias: [FAMILIA_OK], marketplace_connections: [CONEXAO_OK], lotes: [LOTE_PLANILHA],
        variacoes: [VARIACOES_OK], anuncios_externos_itens: [[]],
      });
      expect(segunda).toEqual([{ rootId: 'root-ok', tipo: 'retry' }]);
      expect(atualizarFamiliaUPMock).toHaveBeenCalledTimes(1);
    });
  });

  it('lote de planilha → preservarPublicadas: false', async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'retry' });
    const { admin } = fakeAdmin(filas(LOTE_PLANILHA));
    await criarPortasConvergencia(admin, '2026-01-01T00:00:00Z').resumirComposicao(CLAIM_OK);
    expect(atualizarFamiliaUPMock.mock.calls[0]![0].preservarPublicadas).toBe(false);
  });

  it('erro lendo o lote → lança e atualizarFamiliaUP NÃO é chamado (nunca retoma repreçando as irmãs)', async () => {
    atualizarFamiliaUPMock.mockReset();
    const { admin } = fakeAdmin(filas(LOTE_PLANILHA), {}, {}, { lotes: 'timeout' });
    await expect(criarPortasConvergencia(admin, '2026-01-01T00:00:00Z').resumirComposicao(CLAIM_OK))
      .rejects.toThrow(/lote lote-1.*timeout/);
    expect(atualizarFamiliaUPMock).not.toHaveBeenCalled();
  });
});

describe('resumirComposicao — marca do produto (ADR-0188)', () => {
  it('repassa a marca do produto à saga UP (a retomada não pode herdar o fornecedor do irmão)', async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'ok' });
    const { admin } = fakeAdmin({
      familias: [{ ...FAMILIA_OK, marca: 'Zaven' }], variacoes: [VARIACOES_OK], lotes: [LOTE_PLANILHA], marketplace_connections: [CONEXAO_OK],
    });
    await criarPortasConvergencia(admin, '2026-01-01T00:00:00Z').resumirComposicao(CLAIM_OK);
    expect(atualizarFamiliaUPMock.mock.calls[0][0].marcaProduto).toBe('Zaven');
  });
});
