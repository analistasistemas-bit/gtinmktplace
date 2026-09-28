// Caracterização do caminho manual/legado (ADR-0173): processarColetaOrg continua a mesma
// composição de sempre — radar só no completo, seleção sem filtro de backoff, notificação sem
// chave só quando há alerta. `partes` espiãs no lugar das funções reais.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { moduloHabilitadoStrict, exigirModulo } from '../../_shared/produto/modulo.ts';
import { notificarCategoria } from '../../_shared/notificacoes/config.ts';
import {
  notificarRodadaPulse, processarColetaOrg, type PartesColeta, type ContextoColeta, type ResultadoLote,
} from '../processar.ts';
import type { ConexaoCanal } from '../../_shared/canais/conexao.ts';

vi.mock('../../_shared/produto/modulo.ts', () => ({
  exigirModulo: vi.fn(async () => true),
  moduloHabilitadoStrict: vi.fn(async () => true),
}));
vi.mock('../../_shared/notificacoes/config.ts', () => ({ notificarCategoria: vi.fn(async () => 0) }));

const CX: ConexaoCanal = { id: 'cx-1', orgId: 'org-1', canal: 'mercado_livre', contaExternaId: '999', expiresAt: null };
const CTX: ContextoColeta = { token: 'tok', proprioSellerId: 999, naoClassificavel: false };

function criarPartes(over: Partial<PartesColeta> = {}): PartesColeta {
  return {
    prepararContexto: vi.fn(async () => CTX),
    sincronizarRadar: vi.fn(async () => undefined),
    processarLoteProdutos: vi.fn(async () => ({ produtos: 2, gravadas: 1, alertas: 0, acao: 0 } as ResultadoLote)),
    notificarRodadaPulse: vi.fn(async () => undefined),
    ...over,
  };
}

// Fake mínimo: 2 produtos ativos, com as colunas de backoff (a query não filtra por elas).
function fakeAdmin(): SupabaseClient {
  const linhas = [
    { id: 'p1', catalog_product_id: 'MLB1', codigo_pai: 'COD1', origem: 'auto', titulo: null, coleta_falhas_seguidas: 0, coleta_tentativa_em: null },
    { id: 'p2', catalog_product_id: 'MLB2', codigo_pai: 'COD2', origem: 'auto', titulo: null, coleta_falhas_seguidas: 5, coleta_tentativa_em: null },
  ];
  // deno-lint-ignore no-explicit-any
  const api: any = {
    select: () => api, eq: () => api, order: () => api, limit: () => api,
    then: (resolve: (x: { data: unknown; error: null }) => unknown) => resolve({ data: linhas, error: null }),
  };
  return { from: () => api } as unknown as SupabaseClient;
}

describe('processarColetaOrg (caminho manual/legado) — caracterização', () => {
  it('tier completo: radar 1x, seleção SEM filtro de backoff (as 2 linhas passam), notifica só se alertas>0', async () => {
    const partes = criarPartes();
    const admin = fakeAdmin();
    const r = await processarColetaOrg(admin, CX, 'org-1', 'completo', 50, false, partes);

    expect(partes.prepararContexto).toHaveBeenCalledWith(CX, 'org-1');
    expect(partes.sincronizarRadar).toHaveBeenCalledWith(admin, 'org-1');
    // Sem filtro de backoff: as 2 linhas (uma com 5 falhas seguidas) chegam inteiras.
    expect((partes.processarLoteProdutos as ReturnType<typeof vi.fn>).mock.calls[0][3]).toHaveLength(2);
    expect(partes.notificarRodadaPulse).not.toHaveBeenCalled(); // alertas:0 no mock
    expect(r).toEqual({ produtos: 2, gravadas: 1, alertas: 0 });
  });

  it('tier quente: sem radar', async () => {
    const partes = criarPartes();
    await processarColetaOrg(fakeAdmin(), CX, 'org-1', 'quente', 100, false, partes);
    expect(partes.sincronizarRadar).not.toHaveBeenCalled();
  });

  it('alertas>0 → notifica SEM chave, com {alertas, acao, naoClassificavel} do ctx', async () => {
    const partes = criarPartes({
      processarLoteProdutos: vi.fn(async () => ({ produtos: 2, gravadas: 1, alertas: 3, acao: 1 } as ResultadoLote)),
    });
    const r = await processarColetaOrg(fakeAdmin(), CX, 'org-1', 'completo', 50, false, partes);
    expect(partes.notificarRodadaPulse).toHaveBeenCalledWith(
      expect.anything(), 'org-1', { alertas: 3, acao: 1, naoClassificavel: false },
    );
    // sem 3º argumento (chave)
    expect((partes.notificarRodadaPulse as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(3);
    expect(r).toEqual({ produtos: 2, gravadas: 1, alertas: 3 });
  });
});

describe('notificarRodadaPulse com chave (ADR-0173): leitura do módulo estrita', () => {
  const R = { alertas: 2, acao: 1, naoClassificavel: false };
  beforeEach(() => vi.clearAllMocks());

  it('módulo desligado → não chama notificarCategoria', async () => {
    vi.mocked(moduloHabilitadoStrict).mockResolvedValueOnce(false);
    const admin = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({}) }) }) }) }) } as unknown as SupabaseClient;
    await notificarRodadaPulse(admin, 'org-1', R, 'pulse:pulse-quente:org-1:2026-09-27T12');
    expect(notificarCategoria).not.toHaveBeenCalled();
  });

  it('leitura do módulo com erro → rejeita', async () => {
    vi.mocked(moduloHabilitadoStrict).mockRejectedValueOnce(new Error('organizations: timeout'));
    await expect(notificarRodadaPulse({} as SupabaseClient, 'org-1', R, 'chave-1')).rejects.toThrow('timeout');
    expect(notificarCategoria).not.toHaveBeenCalled();
  });

  it('módulo ligado → chama notificarCategoria(..., { chave })', async () => {
    vi.mocked(moduloHabilitadoStrict).mockResolvedValueOnce(true);
    const admin = {
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 0 }) }) }) }) }),
    } as unknown as SupabaseClient;
    await notificarRodadaPulse(admin, 'org-1', R, 'chave-1');
    expect(notificarCategoria).toHaveBeenCalledWith(admin, 'org-1', 'pulse', expect.any(String), { chave: 'chave-1' });
  });

  it('sem chave (legado): usa exigirModulo, não a versão estrita', async () => {
    vi.mocked(exigirModulo).mockResolvedValueOnce(true);
    const admin = {
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ count: 0 }) }) }) }) }),
    } as unknown as SupabaseClient;
    await notificarRodadaPulse(admin, 'org-1', R);
    expect(exigirModulo).toHaveBeenCalledWith(admin, 'org-1', 'pulse');
    expect(moduloHabilitadoStrict).not.toHaveBeenCalled();
    expect(notificarCategoria).toHaveBeenCalledWith(admin, 'org-1', 'pulse', expect.any(String), undefined);
  });
});
