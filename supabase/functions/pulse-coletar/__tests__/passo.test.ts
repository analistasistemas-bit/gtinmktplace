import { describe, expect, it, vi } from 'vitest';

// passo.ts importa elegivelPorBackoff (valor) de processar.ts, que importa ml/token.ts, que importa
// _shared/supabase.ts (`import { createClient } from 'jsr:...'`) — quebra a resolução sob vitest.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import { SemAcessoRodada, type Acumulado } from '../../_shared/rodada/rodada.ts';
import type { ConexaoCanal } from '../../_shared/canais/conexao.ts';
import type { ContextoColeta, ProdutoColeta, ResultadoLote } from '../processar.ts';
import { JANELA_LEITURA, LOTE_COMPLETO, LOTE_QUENTE, passoPulse, type DepsPulse, type ParamsPulse } from '../passo.ts';

const CX: ConexaoCanal = { id: 'cx-1', orgId: 'org-1', canal: 'mercado_livre', contaExternaId: '999', expiresAt: null };
const CTX: ContextoColeta = { token: 'tok', proprioSellerId: 999, naoClassificavel: false };
const AGORA = Date.parse('2026-09-27T12:00:00Z');

const produto = (id: string, over: Partial<ProdutoColeta> = {}): ProdutoColeta => ({
  id, catalog_product_id: `MLB-${id}`, codigo_pai: null, origem: 'auto', titulo: null,
  coleta_falhas_seguidas: 0, coleta_tentativa_em: null, ...over,
});
const produtos = (n: number, prefixo = 'p'): ProdutoColeta[] =>
  Array.from({ length: n }, (_, i) => produto(`${prefixo}${String(i + 1).padStart(2, '0')}`));

const RESULTADO_LOTE: ResultadoLote = { produtos: 1, gravadas: 1, alertas: 1, acao: 1 };

function criarDeps(over: Partial<DepsPulse> = {}): DepsPulse {
  return {
    conexao: vi.fn(async () => CX),
    contexto: vi.fn(async () => CTX),
    sincronizarRadar: vi.fn(async () => undefined),
    produtos: vi.fn(async () => []),
    processarLote: vi.fn(async () => RESULTADO_LOTE),
    agora: vi.fn(() => AGORA),
    ...over,
  };
}

const COMPLETO: ParamsPulse = { tier: 'completo' };
const QUENTE: ParamsPulse = { tier: 'quente' };

const rodar = (deps: DepsPulse, cursor: string | null, params: ParamsPulse, acumulado: Acumulado = {}) =>
  passoPulse(deps)({ cursor, acumulado, params });

describe('passoPulse (ADR-0173)', () => {
  it('1. completo, cursor null → sincronizarRadar 1x, sem lote, proximo produtos|', async () => {
    const deps = criarDeps();
    const r = await rodar(deps, null, COMPLETO);
    expect(deps.sincronizarRadar).toHaveBeenCalledTimes(1);
    expect(deps.produtos).not.toHaveBeenCalled();
    expect(deps.processarLote).not.toHaveBeenCalled();
    expect(r).toEqual({ proximo: 'produtos|', acumulado: {} });
  });

  it('2. quente, cursor null → sem radar, lote de 40 com baseline:false', async () => {
    expect(LOTE_QUENTE).toBe(40);
    const deps = criarDeps({ produtos: vi.fn(async () => produtos(45)) });
    await rodar(deps, null, QUENTE);
    expect(deps.sincronizarRadar).not.toHaveBeenCalled();
    expect(deps.produtos).toHaveBeenCalledWith('', JANELA_LEITURA, 'quente');
    expect((deps.processarLote as ReturnType<typeof vi.fn>).mock.calls[0][1]).toHaveLength(40);
    expect((deps.processarLote as ReturnType<typeof vi.fn>).mock.calls[0][3]).toBe(false);
  });

  it('3. conexão null → SemAcessoRodada, sem chamar contexto', async () => {
    const deps = criarDeps({ conexao: vi.fn(async () => null) });
    await expect(rodar(deps, null, COMPLETO)).rejects.toBeInstanceOf(SemAcessoRodada);
    expect(deps.contexto).not.toHaveBeenCalled();

    const deps2 = criarDeps({ conexao: vi.fn(async () => null) });
    await expect(rodar(deps2, 'produtos|p10', QUENTE)).rejects.toBeInstanceOf(SemAcessoRodada);
  });

  it('4. 45 elegíveis p01..p45 → lote p01..p10, proximo produtos|p10', async () => {
    expect(LOTE_COMPLETO).toBe(10);
    const deps = criarDeps({ produtos: vi.fn(async () => produtos(45)) });
    const r = await rodar(deps, 'produtos|', COMPLETO);
    const lote = (deps.processarLote as ReturnType<typeof vi.fn>).mock.calls[0][1] as ProdutoColeta[];
    expect(lote.map((p) => p.id)).toEqual(produtos(10).map((p) => p.id));
    expect(r.proximo).toBe('produtos|p10');
  });

  it('5. p01..p10 em backoff + resto elegível → lote p11..p20, proximo produtos|p20', async () => {
    // completo: 3+ falhas com tentativa RECENTE (< 3 dias) barra; tentativa `null` não bastaria.
    const recente = new Date(AGORA).toISOString();
    const lidos = produtos(45).map((p, i) => (
      i < 10 ? { ...p, coleta_falhas_seguidas: 3, coleta_tentativa_em: recente } : p
    ));
    const deps = criarDeps({ produtos: vi.fn(async () => lidos) });
    const r = await rodar(deps, 'produtos|', COMPLETO);
    const lote = (deps.processarLote as ReturnType<typeof vi.fn>).mock.calls[0][1] as ProdutoColeta[];
    expect(lote.map((p) => p.id)).toEqual(Array.from({ length: 10 }, (_, i) => `p${String(i + 11).padStart(2, '0')}`));
    expect(r.proximo).toBe('produtos|p20');
  });

  it('6. janela lida toda em backoff → sem lote, cursor no último lido', async () => {
    const recente = new Date(AGORA).toISOString();
    const lidos = produtos(30).map((p) => ({ ...p, coleta_falhas_seguidas: 3, coleta_tentativa_em: recente }));
    const deps = criarDeps({ produtos: vi.fn(async () => lidos) });
    const r = await rodar(deps, 'produtos|', COMPLETO);
    expect(deps.processarLote).not.toHaveBeenCalled();
    expect(r.proximo).toBe('produtos|p30');
  });

  it('7. lidos vazio → proximo null', async () => {
    const deps = criarDeps({ produtos: vi.fn(async () => []) });
    const r = await rodar(deps, 'produtos|p90', COMPLETO);
    expect(r.proximo).toBeNull();
    expect(deps.processarLote).not.toHaveBeenCalled();
  });

  it('8. naoClassificavel do contexto: false mantém 0; true vira 1 e persiste mesmo com contexto false no lote seguinte', async () => {
    const deps = criarDeps({
      produtos: vi.fn(async () => produtos(5)),
      contexto: vi.fn(async () => ({ ...CTX, naoClassificavel: false })),
    });
    const r1 = await rodar(deps, 'produtos|', COMPLETO);
    expect(r1.acumulado.naoClassificavel).toBe(0);

    const deps2 = criarDeps({
      produtos: vi.fn(async () => produtos(5)),
      contexto: vi.fn(async () => ({ ...CTX, naoClassificavel: true })),
    });
    const r2 = await rodar(deps2, 'produtos|', COMPLETO, {});
    expect(r2.acumulado.naoClassificavel).toBe(1);

    const deps3 = criarDeps({
      produtos: vi.fn(async () => produtos(5)),
      contexto: vi.fn(async () => ({ ...CTX, naoClassificavel: false })),
    });
    const r3 = await rodar(deps3, r2.proximo, COMPLETO, r2.acumulado);
    expect(r3.acumulado.naoClassificavel).toBe(1);
  });

  it('somatório: produtos/gravadas/alertas/acao acumulam entre lotes', async () => {
    const deps = criarDeps({
      produtos: vi.fn(async () => produtos(5)),
      processarLote: vi.fn(async () => ({ produtos: 5, gravadas: 2, alertas: 3, acao: 1 } as ResultadoLote)),
    });
    const r1 = await rodar(deps, 'produtos|', COMPLETO);
    expect(r1.acumulado).toMatchObject({ produtos: 5, gravadas: 2, alertas: 3, acao: 1 });
    const r2 = await rodar(deps, r1.proximo, COMPLETO, r1.acumulado);
    expect(r2.acumulado).toMatchObject({ produtos: 10, gravadas: 4, alertas: 6, acao: 2 });
  });

  it('etapa desconhecida no cursor → lança', async () => {
    const deps = criarDeps();
    await expect(rodar(deps, 'radar|x', COMPLETO)).rejects.toThrow(/etapa/);
  });

  it('cursor malformado (sem "|") → lerCursor lança', async () => {
    const deps = criarDeps();
    await expect(rodar(deps, 'produtoscomerro', COMPLETO)).rejects.toThrow(/cursor inválido/);
  });
});
