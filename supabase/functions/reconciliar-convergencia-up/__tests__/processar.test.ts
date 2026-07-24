import { describe, it, expect, vi } from 'vitest';

// Cadeia real (ml/token.ts → _shared/supabase.ts; queue.ts → npm:qstash; notificacoes/config.ts)
// puxa jsr/npm/Deno — mockada pro vitest (mesmo padrão de
// atualizar-familia-up/__tests__ e update-familia-ml/__tests__/processar.test.ts).
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));
vi.mock('../../_shared/queue.ts', () => ({ enfileirarVinculacaoCatalogo: vi.fn() }));
vi.mock('../../_shared/notificacoes/config.ts', () => ({ notificarCategoria: vi.fn() }));

// atualizarFamiliaUP é a saga real (exaustivamente testada em atualizar-familia-up.test.ts) —
// mockada aqui pra isolar SÓ a rede de segurança deste adapter (achado real, revisão adversarial
// 3ª rodada: o UPDATE de limpeza engolia o próprio erro com console.error, reportando 'convergiu'
// com a raiz ainda travada em mudando_composicao=true).
const atualizarFamiliaUPMock = vi.hoisted(() => vi.fn());
vi.mock('../../_shared/user-products/atualizar-familia-up.ts', () => ({ atualizarFamiliaUP: atualizarFamiliaUPMock }));

import { criarPortasConvergencia, listarRaizesTravadas } from '../processar';

// Fake admin: fila FIFO por tabela + interceptação de rpc(). Cobre os 2 achados críticos da
// revisão adversarial (2ª rodada): (1) guard de SKU sem dado fonte falha ANTES de qualquer
// mutação remota — nem chega a resolver conexão/token; (2) família não encontrada (referenciada
// pela raiz mas já apagada) falha com mensagem clara, não crasha ambíguo.
// `updateErros`: marca `{tabela}` cuja PRÓXIMA chamada a `update()` deve resolver `{error}`.
function fakeAdmin(filas: Record<string, unknown[]> = {}, rpcs: Record<string, unknown> = {}, updateErros: Record<string, string> = {}) {
  const updates: { tabela: string; payload: Record<string, unknown> }[] = [];
  const proximo = (tabela: string) => {
    const fila = filas[tabela] ?? [];
    return fila.length ? fila.shift() : [];
  };
  function chain(tabela: string): any {
    const obj: any = {
      select: () => obj,
      eq: () => obj,
      lt: () => obj,
      maybeSingle: async () => ({ data: proximo(tabela), error: null }),
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
  return { admin, updates };
}

const FAMILIA_OK = { id: 'fam-1', org_id: 'org-1', codigo_pai: '00012345' };
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
    const ids = await listarRaizesTravadas({ admin }, '2026-01-01T00:00:00Z');
    expect(ids).toEqual(['root-1', 'root-2']);
  });

  it('erro na query → lança (fail-closed)', async () => {
    const { admin } = fakeAdmin();
    admin.from = () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ lt: async () => ({ data: null, error: { message: 'timeout' } }) }) }) }) }) });
    await expect(listarRaizesTravadas({ admin }, '2026-01-01T00:00:00Z')).rejects.toThrow(/timeout/);
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
      familias: [FAMILIA_OK], variacoes: [VARIACOES_OK], marketplace_connections: [CONEXAO_OK],
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
      { familias: [FAMILIA_OK], variacoes: [VARIACOES_OK], marketplace_connections: [CONEXAO_OK] },
      {},
      { anuncios_externos: 'timeout' },
    );
    const portas = criarPortasConvergencia(admin, '2026-01-01T00:00:00Z');
    await expect(portas.resumirComposicao(CLAIM_OK)).rejects.toThrow(/limpeza de segurança falhou.*timeout/);
  });

  it("atualizarFamiliaUP retorna estado:'retry' → NÃO dispara a limpeza (raiz segue travada de propósito, ainda incompleta)", async () => {
    atualizarFamiliaUPMock.mockReset().mockResolvedValueOnce({ estado: 'retry' });
    const { admin, updates } = fakeAdmin({
      familias: [FAMILIA_OK], variacoes: [VARIACOES_OK], marketplace_connections: [CONEXAO_OK],
    });
    const portas = criarPortasConvergencia(admin, '2026-01-01T00:00:00Z');
    const resultado = await portas.resumirComposicao(CLAIM_OK);
    expect(resultado).toEqual({ estado: 'retry' });
    expect(updates.some((u) => u.tabela === 'anuncios_externos')).toBe(false);
  });
});
