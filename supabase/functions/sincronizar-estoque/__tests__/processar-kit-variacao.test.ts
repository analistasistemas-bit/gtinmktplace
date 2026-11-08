import { describe, it, expect, vi, beforeEach } from 'vitest';

// ml/token.ts importa _shared/supabase.ts (jsr real), irresolúvel no vitest.
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'fake-token' }));

import { alertarZeradosConfirmados, processarSincronizacao, type DepsSincronizacao } from '../processar.ts';
import { fakeConnector } from '../../_shared/canais/fake';
import type { ChannelConnector } from '../../_shared/canais/contrato';

// ADR-0199 (Task 5): SKU de kit com variação nunca recebe push absoluto; vira transferência `entrada`.

interface Banco {
  modulos: string[];
  componentes: string[];
  falhar?: string;
  rpc?: Record<string, unknown>;
  semUp?: boolean;
  /** Item local de P1 fora de `ativo` (pausado no vínculo): `resolverAlvosPush` o descartaria. */
  p1Pausado?: boolean;
  /** Movimentos >0 → 0 de P1 (z1) e P2 (z2), ainda sem alerta. */
  zerados?: boolean;
  /** P1 e P2 como variações de um item Legacy só (sem filhos UP). */
  mesmoItem?: boolean;
}

const ITENS = [
  { anuncio_externo_id: 'A', sku: 'P1', item_externo_id: 'MLB-P1', user_product_id: 'UP-P1', catalog_listing_id: 'MLB-P1C', retirado: false, status: 'ativo', org_id: 'O' },
  { anuncio_externo_id: 'A', sku: 'P2', item_externo_id: 'MLB-P2', user_product_id: 'UP-P2', catalog_listing_id: null, retirado: false, status: 'ativo', org_id: 'O' },
];

function fakeAdmin(b: Banco) {
  // Outbox de P1, na ordem do ledger: m1 entrada, m2 entrada (o último push local), m3 venda do ML e m4
  // movimento da saga, ambos posteriores e que nunca podem ser reabertos. m9 é de outro SKU. `criado_em`
  // fora de ordem de propósito: quem manda é `ordem`.
  const mov = (id: string, codigo: string, ordem: number, criado: string, extra: Record<string, unknown> = {}) => ({
    id, org_id: 'O', codigo, codigo_pai: 'PAI', ordem, criado_em: criado, push_enfileirado_em: `${id}-marcado`,
    push_canal_origem: null, transferencia_id: null, ...extra,
  });
  const movs: Array<Record<string, unknown>> = [
    mov('m1', 'P1', 1, '2026-11-07T12:00:00Z'),
    mov('m2', 'P1', 2, '2026-11-07T10:00:00Z'),
    mov('m3', 'P1', 3, '2026-11-07T11:00:00Z', { push_canal_origem: 'mercado_livre' }),
    mov('m4', 'P1', 4, '2026-11-07T11:10:00Z', { transferencia_id: 'T0' }),
    mov('m9', 'P2', 5, '2026-11-07T11:30:00Z'),
    ...(b.zerados ? [
      mov('z1', 'P1', 6, '2026-11-07T11:40:00Z', { estoque_anterior: 2, estoque_resultante: 0, alertado_em: null }),
      mov('z2', 'P2', 7, '2026-11-07T11:41:00Z', { estoque_anterior: 1, estoque_resultante: 0, alertado_em: null }),
      // Saída de montagem (movimento da própria transferência) que zerou P1: nunca é "estoque zerado".
      mov('z3', 'P1', 8, '2026-11-07T11:42:00Z', { estoque_anterior: 1, estoque_resultante: 0, alertado_em: null, transferencia_id: 'T9' }),
    ] : []),
  ];
  const consultas: string[] = [];
  const rpcs: Array<{ nome: string; args: Record<string, unknown> }> = [];
  const from = (tabela: string) => {
    consultas.push(tabela);
    const filtros: Array<(r: Record<string, unknown>) => boolean> = [];
    let kitsVinculados = false;
    let patch: Record<string, unknown> | null = null;
    const ler = () => {
      if (b.falhar === tabela) return { data: null, error: { message: 'boom' } };
      if (kitsVinculados) return { data: [], error: null };
      switch (tabela) {
        // ADR-0199: o módulo chega embutido na leitura de família que o caminho já faz.
        case 'familias':
          return { data: { id: 'F', nome_pai: 'Blusa', ml_permalink: null, organizations: { modulos_habilitados: b.modulos } }, error: null };
        case 'variacoes': return { data: [{ codigo: 'P1', estoque: 4 }, { codigo: 'P2', estoque: 6 }], error: null };
        case 'anuncios_externos':
          return { data: [b.mesmoItem
            ? { id: 'A', canal: 'fake', item_externo_id: 'MLB-X', variacoes_externas: { P1: 1, P2: 2 } }
            : { id: 'A', canal: 'fake', item_externo_id: null, variacoes_externas: null }], error: null };
        case 'anuncios_externos_itens':
          if (b.mesmoItem) return { data: [], error: null };
          return { data: ITENS.map((r) => (b.semUp ? { ...r, user_product_id: null } : r))
            .map((r) => (b.p1Pausado && r.sku === 'P1' ? { ...r, status: 'pausado' } : r))
            .filter((r) => filtros.every((f) => f(r))), error: null };
        case 'kit_variacao_skus': return { data: [], error: null };
        case 'kit_variacao_componentes':
          return { data: b.componentes.map((codigo) => ({ codigo, org_id: 'O' })).filter((r) => filtros.every((f) => f(r))), error: null };
        case 'estoque_movimentos': {
          const alvo = movs.filter((r) => filtros.every((f) => f(r)));
          if (patch) alvo.forEach((r) => Object.assign(r, patch));
          return { data: alvo.map((r) => ({ ...r })), error: null };
        }
        default: return { data: [], error: null };
      }
    };
    const api: Record<string, unknown> = {
      select: () => api,
      update: (v: Record<string, unknown>) => { patch = v; return api; },
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return api; },
      in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.includes(r[c])); return api; },
      is: (c: string, v: unknown) => { filtros.push((r) => !(c in r) || (r[c] ?? null) === v); return api; },
      gt: () => api, not: () => { kitsVinculados = true; return api; },
      order: () => api, limit: () => api,
      maybeSingle: async () => ler(),
      then: (res: (v: unknown) => unknown) => Promise.resolve(ler()).then(res),
    };
    return api;
  };
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    // Participação é leitura (RPC agregada): conta em `consultas`, não em `rpcs`.
    if (nome === 'kit_skus_participantes') {
      consultas.push(nome);
      if (b.falhar === nome) return { data: null, error: { message: 'boom' } };
      return { data: b.componentes.filter((c) => (args.p_codigos as string[]).includes(c)), error: null };
    }
    rpcs.push({ nome, args });
    return { data: b.rpc?.[nome] ?? { ok: true, id: 'T1' }, error: null };
  };
  return { admin: { from, rpc } as never, consultas, rpcs, movs };
}

function montar(b: Banco) {
  const f = fakeAdmin(b);
  const enfileirarSaga = vi.fn(async () => {});
  const notificar = vi.fn(async () => {});
  const deps: DepsSincronizacao = {
    admin: f.admin,
    resolverConexao: (async () => ({ id: 'c' })) as never,
    getConnector: (() => fakeConnector as unknown as ChannelConnector) as never,
    fabricarToken: () => () => Promise.resolve('tok'),
    notificar: notificar as never,
    enfileirarSaga,
  };
  return { deps, enfileirarSaga, notificar, ...f };
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

  it('participante com item local fora de ativo não some: vira transferência', async () => {
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'], p1Pausado: true });
    const r = await processarSincronizacao(m.deps, JOB);
    expect(r.status).toBe(200);
    expect(pushes()).toEqual(['MLB-P2']);
    expect(m.rpcs.find((x) => x.nome === 'kit_criar_transferencia')?.args.p_alvos)
      .toEqual([{ codigo: 'P1', up_id: 'UP-P1', item_ids: ['MLB-P1', 'MLB-P1C'] }]);
  });

  it('SKU comum com item fora de ativo segue fora do push, como hoje', async () => {
    const m = montar({ modulos: ['kit_variacao'], componentes: [], p1Pausado: true });
    await processarSincronizacao(m.deps, JOB);
    expect(pushes()).toEqual(['MLB-P2']);
    expect(m.rpcs).toEqual([]);
  });

  it('participante não é reativado pelo push (só os alvos empurrados)', async () => {
    fakeConnector.statusVivo = 'pausado';
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'] });
    await processarSincronizacao(m.deps, JOB);
    const lidos = fakeConnector.chamadas.filter((c) => c.metodo === 'lerStatus')
      .flatMap((c) => (c.args as { itemExternoIds: string[] }).itemExternoIds);
    expect(lidos).not.toContain('MLB-P1');
  });

  it('Task 6: reativar=true não ativa o participante (nem a cópia de catálogo); o SKU comum reativa (ADR-0111)', async () => {
    fakeConnector.statusVivo = 'pausado';
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'] });
    await processarSincronizacao(m.deps, JOB);
    const ativados = fakeConnector.chamadas.filter((c) => c.metodo === 'atualizarStatus')
      .map((c) => c.args as { itemExternoId: string; status: string });
    expect(ativados).toEqual([{ itemExternoId: 'MLB-P2', status: 'ativo' }]);
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
    // A intenção volta ao outbox: só o último movimento do SKU recusado, nenhum outro.
    expect(m.movs.map((x) => [x.id, x.push_enfileirado_em])).toEqual([
      ['m1', 'm1-marcado'], ['m2', null], ['m3', 'm3-marcado'], ['m4', 'm4-marcado'], ['m9', 'm9-marcado'],
    ]);
  });

  it('transferência criada: o outbox não é tocado', async () => {
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'] });
    await processarSincronizacao(m.deps, JOB);
    expect(m.movs.every((x) => x.push_enfileirado_em !== null)).toBe(true);
  });

  it('zero de participante não é anunciado nem marcado pelo push: fica para a saga (achado 5 da revisão final)', async () => {
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'], zerados: true });
    expect((await processarSincronizacao(m.deps, JOB)).status).toBe(200);
    expect(m.movs.find((x) => x.id === 'z1')!.alertado_em).toBeNull();
    expect(m.movs.find((x) => x.id === 'z2')!.alertado_em).not.toBeNull();
    const zerado = m.notificar.mock.calls.map((c) => String((c as unknown[])[3])).filter((t) => t.includes('Estoque zerado'));
    expect(zerado).toHaveLength(1);
    expect(zerado[0]).toContain('P2');
    expect(zerado[0]).not.toContain('P1');
  });

  it('confirmação da saga: marca e anuncia só os códigos confirmados (achado 5)', async () => {
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'], zerados: true });
    await alertarZeradosConfirmados(m.admin, m.notificar as never, 'O', ['P1']);
    expect(m.movs.find((x) => x.id === 'z1')!.alertado_em).not.toBeNull();
    expect(m.movs.find((x) => x.id === 'z2')!.alertado_em).toBeNull();
    expect(m.movs.find((x) => x.id === 'z3')!.alertado_em).toBeNull();
    expect(m.notificar).toHaveBeenCalledTimes(1);
    expect(String((m.notificar.mock.calls[0] as unknown[])[3])).toMatch(/Estoque zerado[\s\S]*P1/);
    // Reentrega: a marca deduplica.
    await alertarZeradosConfirmados(m.admin, m.notificar as never, 'O', ['P1']);
    expect(m.notificar).toHaveBeenCalledTimes(1);
  });

  it('confirmação de montagem que só zerou pelo próprio movimento não avisa (achado 5)', async () => {
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'], zerados: true });
    m.movs.find((x) => x.id === 'z1')!.alertado_em = 'antes';
    await alertarZeradosConfirmados(m.admin, m.notificar as never, 'O', ['P1']);
    expect(m.movs.find((x) => x.id === 'z3')!.alertado_em).toBeNull();
    expect(m.notificar).not.toHaveBeenCalled();
  });

  it('SKU comum no mesmo item do participante: fora do push, mas o zero dele segue no aviso como hoje', async () => {
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'], zerados: true, mesmoItem: true });
    expect((await processarSincronizacao(m.deps, JOB)).status).toBe(200);
    expect(pushes()).toEqual([]);
    expect(m.movs.find((x) => x.id === 'z1')!.alertado_em).toBeNull();
    expect(m.movs.find((x) => x.id === 'z2')!.alertado_em).not.toBeNull();
    const zerado = m.notificar.mock.calls.map((c) => String((c as unknown[])[3])).filter((x) => x.includes('Estoque zerado'));
    expect(zerado).toHaveLength(1);
    expect(zerado[0]).toContain('P2');
  });

  it('SKU comum zerado em org sem o módulo: alerta como hoje', async () => {
    const m = montar({ modulos: [], componentes: ['P1'], zerados: true });
    expect((await processarSincronizacao(m.deps, JOB)).status).toBe(200);
    expect(m.movs.filter((x) => x.alertado_em === null).map((x) => x.id)).toEqual([]);
    expect(m.consultas).not.toContain('kit_skus_participantes');
  });

  it('criarTransferencia que lança também devolve a intenção ao outbox e relança', async () => {
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'] });
    const admin = m.deps.admin as unknown as { rpc: (n: string, a: Record<string, unknown>) => Promise<unknown> };
    const rpcOriginal = admin.rpc;
    m.deps.admin = {
      ...(m.deps.admin as object),
      rpc: async (n: string, a: Record<string, unknown>) =>
        (n === 'kit_skus_participantes' ? rpcOriginal(n, a) : { data: null, error: { message: 'timeout' } }),
    } as never;
    await expect(processarSincronizacao(m.deps, JOB)).rejects.toThrow(/timeout/);
    expect(m.movs.find((x) => x.id === 'm2')!.push_enfileirado_em).toBeNull();
  });

  it.each(['familias', 'kit_skus_participantes'])('falha ao ler %s lança antes de qualquer push', async (t) => {
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

  it('participante sem UP: sem push, sem transferência, com alerta', async () => {
    const m = montar({ modulos: ['kit_variacao'], componentes: ['P1'], semUp: true });
    await processarSincronizacao(m.deps, JOB);
    expect(pushes()).not.toContain('MLB-P1');
    expect(m.rpcs).toEqual([]);
    expect(m.notificar).toHaveBeenCalledWith(expect.anything(), 'O', 'estoque', expect.stringContaining('P1'));
  });

  it('alvos_invalidos: alerta em vez de sucesso silencioso', async () => {
    const m = montar({
      modulos: ['kit_variacao'], componentes: ['P1'],
      rpc: { kit_criar_transferencia: { ok: false, motivo: 'alvos_invalidos' } },
    });
    await processarSincronizacao(m.deps, JOB);
    expect(m.notificar).toHaveBeenCalledWith(expect.anything(), 'O', 'estoque', expect.stringContaining('P1'));
  });

  it('org sem o módulo: empurra tudo como hoje e não lê tabela de kit', async () => {
    const m = montar({ modulos: [], componentes: ['P1'] });
    const r = await processarSincronizacao(m.deps, JOB);
    expect(r.status).toBe(200);
    expect(pushes()).toEqual(['MLB-P1', 'MLB-P2']);
    // Exatamente as consultas de antes da Task 5: nenhuma nova, nem a do módulo.
    expect(m.consultas).toEqual([
      'familias', 'familias', 'variacoes', 'familias', 'anuncios_externos', 'anuncios_externos_itens',
      'estoque_movimentos',
    ]);
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
