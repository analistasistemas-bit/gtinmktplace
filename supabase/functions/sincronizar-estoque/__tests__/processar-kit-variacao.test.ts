import { describe, it, expect, vi, beforeEach } from 'vitest';

// ml/token.ts importa _shared/supabase.ts (jsr real), irresolúvel no vitest.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import { processarSincronizacao, type DepsSincronizacao } from '../processar.ts';
import { fakeConnector } from '../../_shared/canais/fake';
import type { ChannelConnector } from '../../_shared/canais/contrato';

// ADR-0197 (Task 5): SKU de kit com variação nunca recebe push absoluto; vira transferência `entrada`.

interface Banco {
  modulos: string[];
  componentes: string[];
  falhar?: string;
  rpc?: Record<string, unknown>;
}

const ITENS = [
  { anuncio_externo_id: 'A', sku: 'P1', item_externo_id: 'MLB-P1', user_product_id: 'UP-P1', catalog_listing_id: 'MLB-P1C', retirado: false, status: 'ativo', org_id: 'O' },
  { anuncio_externo_id: 'A', sku: 'P2', item_externo_id: 'MLB-P2', user_product_id: 'UP-P2', catalog_listing_id: null, retirado: false, status: 'ativo', org_id: 'O' },
];

function fakeAdmin(b: Banco) {
  const consultas: string[] = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const from = (tabela: string) => {
    consultas.push(tabela);
    const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
    let kitsVinculados = false;
    const ler = () => {
      if (b.falhar === tabela) return { data: null, error: { message: 'boom' } };
      if (kitsVinculados) return { data: [], error: null };
      switch (tabela) {
        case 'organizations': return { data: { modulos_habilitados: b.modulos }, error: null };
        case 'familias': return { data: { id: 'F', nome_pai: 'Blusa', ml_permalink: null }, error: null };
        case 'variacoes': return { data: [{ codigo: 'P1', estoque: 4 }, { codigo: 'P2', estoque: 6 }], error: null };
        case 'anuncios_externos':
          return { data: [{ id: 'A', canal: 'fake', item_externo_id: null, variacoes_externas: null }], error: null };
        case 'anuncios_externos_itens': return { data: ITENS.filter((r) => filtros.every((f) => f(r))), error: null };
        case 'kit_variacao_skus': return { data: [], error: null };
        case 'kit_variacao_componentes':
          return { data: b.componentes.map((codigo) => ({ codigo, org_id: 'O' })).filter((r) => filtros.every((f) => f(r))), error: null };
        default: return { data: [], error: null };
      }
    };
    const api: Record<string, unknown> = {
      select: () => api,
      update: () => api,
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return api; },
      in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.includes(r[c])); return api; },
      is: () => api, gt: () => api, not: () => { kitsVinculados = true; return api; },
      order: () => api, limit: () => api,
      maybeSingle: async () => ler(),
      then: (res: (v: unknown) => unknown) => Promise.resolve(ler()).then(res),
    };
    return api;
  };
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    rpcs.push({ nome, args });
    return { data: b.rpc?.[nome] ?? { ok: true, id: 'T1' }, error: null };
  };
  return { admin: { from, rpc } as never, consultas, rpcs };
}

function montar(b: Banco) {
  const f = fakeAdmin(b);
  const enfileirarSaga = vi.fn(async () => {});
  const deps: DepsSincronizacao = {
    admin: f.admin,
    resolverConexao: (async () => ({ id: 'c' })) as never,
    getConnector: (() => fakeConnector as unknown as ChannelConnector) as never,
    fabricarToken: () => () => Promise.resolve('tok'),
    notificar: (async () => {}) as never,
    enfileirarSaga,
  };
  return { deps, enfileirarSaga, ...f };
}

const pushes = () => fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarEstoque')
  .map((c) => (c.args as { itemExternoId: string }).itemExternoId);

const JOB = { org_id: 'O', codigo_pai: 'PAI', canal_origem: null, reativar: true };

describe('sincronizar-estoque × kit com variação', () => {
  beforeEach(() => fakeConnector.reset());

  it('SKU participante não gera push e cria transferência entrada com UP e cópia de catálogo', async () => {
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'] });
    const r = await processarSincronizacao(m.deps, JOB);
    expect(r.status).toBe(200);
    expect(pushes()).toEqual(['MLB-P2']);
    const criar = m.rpcs.find((x) => x.nome === 'kit_criar_transferencia')!;
    expect(criar.args).toEqual({
      p_org: 'O', p_kit: null, p_tipo: 'entrada',
      p_itens: [{ codigo: 'P1', quantidade: 0 }],
      p_alvos: [{ codigo: 'P1', up_id: 'UP-P1', item_ids: ['MLB-P1', 'MLB-P1C'] }],
    });
    expect(m.enfileirarSaga).toHaveBeenCalledWith('T1', 'O');
  });

  it('participante não é reativado pelo push (só os alvos empurrados)', async () => {
    fakeConnector.statusVivo = 'pausado';
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'] });
    await processarSincronizacao(m.deps, JOB);
    const lidos = fakeConnector.chamadas.filter((c) => c.metodo === 'lerStatus')
      .flatMap((c) => (c.args as { itemExternoIds: string[] }).itemExternoIds);
    expect(lidos).not.toContain('MLB-P1');
  });

  it('up_ocupado: não empurra o participante e devolve 500 para a fila repetir', async () => {
    const m = montar({
      modulos: ['kit_variacao'], componentes: ['P1'],
      rpc: { kit_criar_transferencia: { ok: false, motivo: 'up_ocupado', codigo: 'P1' } },
    });
    const r = await processarSincronizacao(m.deps, JOB);
    expect(r.status).toBe(500);
    expect(pushes()).toEqual(['MLB-P2']);
    expect(m.enfileirarSaga).not.toHaveBeenCalled();
  });

  it.each(['organizations', 'kit_variacao_componentes'])('falha ao ler %s lança antes de qualquer push', async (t) => {
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'], falhar: t });
    await expect(processarSincronizacao(m.deps, JOB)).rejects.toThrow();
    expect(pushes()).toEqual([]);
  });

  it('job da reconciliação (sem_transferencia_kit) só tira o participante, sem criar transferência', async () => {
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'] });
    const r = await processarSincronizacao(m.deps, { ...JOB, sem_transferencia_kit: true });
    expect(r.status).toBe(200);
    expect(pushes()).toEqual(['MLB-P2']);
    expect(m.rpcs).toEqual([]);
  });

  it('org sem o módulo: empurra tudo como hoje e não lê tabela de kit', async () => {
    const m = montar({ modulos: [], componentes: ['P1'] });
    const r = await processarSincronizacao(m.deps, JOB);
    expect(r.status).toBe(200);
    expect(pushes()).toEqual(['MLB-P1', 'MLB-P2']);
    expect(m.consultas.filter((t) => t.startsWith('kit_'))).toEqual([]);
    expect(m.rpcs).toEqual([]);
  });

  it('SKU comum em org com o módulo segue igual', async () => {
    const m = montar({ modulos: ['kit_variacao'], componentes: [] });
    const r = await processarSincronizacao(m.deps, JOB);
    expect(r.status).toBe(200);
    expect(pushes()).toEqual(['MLB-P1', 'MLB-P2']);
    expect(m.rpcs).toEqual([]);
  });
});
