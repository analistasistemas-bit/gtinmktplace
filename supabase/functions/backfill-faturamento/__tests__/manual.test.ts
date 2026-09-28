// Caracterização do caminho manual/legado (ADR-0173): `processarConexao` continua fazendo o que
// fazia antes do fan-out — perguntas, claims, vendas (varredura MP de 120 dias) e mensagens com as
// funções NÃO estritas. Só o `io` é trocado por fakes; a lógica é a de produção.
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => ({}) }));
vi.mock('../../_shared/auth.ts', () => ({ requireUserOrg: vi.fn() }));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: vi.fn() }));
vi.mock('../../_shared/queue.ts', () => ({ verificarAssinatura: vi.fn(), qstashClient: vi.fn() }));
vi.mock('../../_shared/rodada/deps.ts', () => ({
  depsRodada: vi.fn(), publicarDisparo: vi.fn(), fanoutAtivo: vi.fn(() => false), urlDaFuncao: vi.fn(),
}));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn() }));
vi.mock('../../_shared/ml/liveness.ts', () => ({ registrarFalhaAuth: vi.fn() }));

type Mod = typeof import('../index.ts');
let processarConexao: Mod['processarConexao'];

beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: vi.fn(), env: { get: () => undefined } });
  ({ processarConexao } = await import('../index.ts'));
});

const CX = { id: 'cx-1', orgId: 'org-1', canal: 'mercado_livre', contaExternaId: '999', expiresAt: null, criadoPor: 'user-1' };
const INTERVALO = { desde: '2026-09-01T00:00:00.000Z', ate: '2026-09-27T00:00:00.000Z' };
const CATALOGO = {
  idsPubliai: new Set<string>(), codigoResolver: 'cod', eanResolver: 'ean', infoPorGtin: 'info', custoVigenteResolver: 'custo',
};
const LIQUIDO = new Map([['pay-1', { liquido: 1 }]]);
const GTINS = new Map<string, string>();

function criarIo() {
  return {
    getValidAccessTokenConexao: vi.fn(async () => 'tok'),
    buscarPerguntasSeller: vi.fn(async () => [{ id: 'q1', item_id: 'MLB1' }]),
    buscarTituloItem: vi.fn(async () => 'Título'),
    upsertPergunta: vi.fn(async () => undefined),
    buscarClaimsSeller: vi.fn(async () => [{ id: 'c1' }]),
    buscarReturn: vi.fn(async () => ({ id: 'r1' })),
    upsertDevolucao: vi.fn(async () => undefined),
    buscarPedidosPeriodo: vi.fn(async () => [{ id: 1, shipping: { id: 55 } }, { id: 2 }]),
    carregarCatalogo: vi.fn(async () => CATALOGO),
    carregarLiquidoMP: vi.fn(async () => LIQUIDO),
    carregarGtinsFallback: vi.fn(async () => GTINS),
    buscarFreteVendedor: vi.fn(async () => 12),
    buscarShipment: vi.fn(async () => ({ id: 55 })),
    upsertVenda: vi.fn(async () => undefined),
    listarPacksDeVendas: vi.fn(async () => [{ packId: 'p1' }]),
    buscarMensagensPack: vi.fn(async () => [{ id: 'm1' }]),
    upsertMensagens: vi.fn(async () => ({ novasRecebidas: 0 })),
  };
}

describe('processarConexao (caminho manual/legado) — caracterização', () => {
  it('soVendas:false → perguntas, claims, vendas com MP de 120 dias e mensagens', async () => {
    const io = criarIo();
    const admin = { tag: 'admin' };
    // deno-lint-ignore no-explicit-any
    const r = await processarConexao(admin as any, CX, INTERVALO, false, io as any);

    expect(r).toEqual({ sincronizados: 2, leituraFalhou: false, pedidosComFalha: 0, mpFalhou: false });
    expect(io.getValidAccessTokenConexao).toHaveBeenCalledWith(CX);
    expect(io.buscarPerguntasSeller).toHaveBeenCalledWith('tok');
    expect(io.upsertPergunta).toHaveBeenCalledWith(admin, 'user-1', 'org-1', { id: 'q1', item_id: 'MLB1' }, 'Título', 'tok');
    expect(io.buscarClaimsSeller).toHaveBeenCalledWith('tok');
    expect(io.upsertDevolucao).toHaveBeenCalledWith(admin, 'user-1', 'org-1', { id: 'c1' }, { id: 'r1' }, '999');
    expect(io.buscarPedidosPeriodo).toHaveBeenCalledWith('tok', INTERVALO);
    expect(io.carregarCatalogo).toHaveBeenCalledWith(admin, 'user-1');
    // Varredura de 120 dias (default de carregarLiquidoMP), não a leitura por pedido.
    expect(io.carregarLiquidoMP).toHaveBeenCalledTimes(1);
    expect(io.carregarLiquidoMP).toHaveBeenCalledWith('tok', 999);
    expect(io.buscarFreteVendedor).toHaveBeenCalledWith('tok', 55);
    expect(io.buscarFreteVendedor).toHaveBeenCalledWith('tok', null);
    expect(io.upsertVenda).toHaveBeenCalledTimes(2);
    expect(io.upsertVenda).toHaveBeenCalledWith(admin, 'user-1', 'org-1', { id: 1, shipping: { id: 55 } }, {
      freteVendedor: 12, shipment: { id: 55 }, idsPubliai: CATALOGO.idsPubliai, codigoResolver: 'cod', eanResolver: 'ean',
      infoPorGtin: 'info', gtinPorItem: GTINS, custoVigenteResolver: 'custo', contaExternaId: '999', liquidoPorPayment: LIQUIDO,
    });
    expect(io.listarPacksDeVendas).toHaveBeenCalledWith(admin, 'user-1');
    expect(io.buscarMensagensPack).toHaveBeenCalledWith('tok', 'p1', '999');
    expect(io.upsertMensagens).toHaveBeenCalledWith(admin, 'user-1', 'org-1', 'p1', { packId: 'p1' }, '999', [{ id: 'm1' }]);
  });

  it('soVendas:true → pula perguntas, claims e mensagens', async () => {
    const io = criarIo();
    // deno-lint-ignore no-explicit-any
    const r = await processarConexao({} as any, CX, INTERVALO, true, io as any);
    expect(r.sincronizados).toBe(2);
    expect(io.buscarPerguntasSeller).not.toHaveBeenCalled();
    expect(io.buscarClaimsSeller).not.toHaveBeenCalled();
    expect(io.listarPacksDeVendas).not.toHaveBeenCalled();
    expect(io.buscarMensagensPack).not.toHaveBeenCalled();
    expect(io.buscarPedidosPeriodo).toHaveBeenCalledTimes(1);
    expect(io.carregarLiquidoMP).toHaveBeenCalledWith('tok', 999);
  });

  it('MP null → mpFalhou e upsert com liquidoPorPayment undefined; token falha → leituraFalhou', async () => {
    const io = criarIo();
    io.carregarLiquidoMP.mockResolvedValue(null as unknown as typeof LIQUIDO);
    // deno-lint-ignore no-explicit-any
    const r = await processarConexao({} as any, CX, INTERVALO, true, io as any);
    expect(r.mpFalhou).toBe(true);
    expect(io.upsertVenda.mock.calls[0][4]).toMatchObject({ liquidoPorPayment: undefined });

    const io2 = criarIo();
    io2.getValidAccessTokenConexao.mockRejectedValue(new Error('x'));
    // deno-lint-ignore no-explicit-any
    expect(await processarConexao({} as any, CX, INTERVALO, false, io2 as any))
      .toEqual({ sincronizados: 0, leituraFalhou: true, pedidosComFalha: 0, mpFalhou: false });
  });
});
