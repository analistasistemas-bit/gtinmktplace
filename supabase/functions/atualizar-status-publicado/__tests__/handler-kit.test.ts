// ADR-0200 (Task 6): pausar/reativar individual de SKU participante de kit com variação.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  modulos: [] as string[],
  componentes: [] as string[],
  politicas: [] as Array<Record<string, unknown>>,
  statusVivo: 'pausado',
  consultas: [] as string[],
  eventos: [] as string[],
  put: { ok: true } as Record<string, unknown>,
}));

const ITENS = [{ org_id: 'O', sku: 'P1', item_externo_id: 'MLB1', catalog_listing_id: null }];

function builder(tabela: string) {
  f.consultas.push(tabela);
  const ler = () => {
    switch (tabela) {
      case 'marketplace_connections':
        return { data: { id: 'c', org_id: 'O', canal: 'mercado_livre', conta_externa_id: '1', expires_at: null,
          organizations: { modulos_habilitados: f.modulos } }, error: null };
      case 'anuncios_externos_itens': return { data: ITENS, error: null };
      case 'sku_politica_kit': return { data: f.politicas, error: null };
      default: return { data: [], error: null };
    }
  };
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, in: () => q, or: () => q,
    upsert: async () => { f.eventos.push(`upsert:${tabela}`); return { error: null }; },
    delete: () => { f.eventos.push(`delete:${tabela}`); return q; },
    maybeSingle: async () => (tabela === 'kit_ativacoes' ? { data: null, error: null } : ler()),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(ler()).then(ok, ko),
  };
  return q;
}

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: (t: string) => builder(t),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      // Participação é leitura (RPC agregada): conta em `consultas`, não em `eventos`.
      if (nome === 'kit_skus_participantes') {
        f.consultas.push(nome);
        return { data: f.componentes.filter((c) => (args.p_codigos as string[]).includes(c)), error: null };
      }
      f.eventos.push(`rpc:${nome}${nome === 'kit_politica_operador' ? `:${args.p_bloquear}` : ''}`);
      return { data: nome === 'kit_ativacao_liberar' ? true : { ok: true, anterior: false }, error: null };
    },
  }),
}));
vi.mock('../../_shared/auth.ts', () => ({ requireUserOrg: async () => ({ orgId: 'O', isAdmin: true, support: null }) }));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: async () => {} }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'tok' }));
vi.mock('../../_shared/user-products/guard-migracao-pxv.ts', () => ({ motivoMigracaoPxvPorItem: async () => null }));
vi.mock('../../_shared/notificacoes/config.ts', () => ({
  notificarCategoria: async () => { f.eventos.push('alerta'); },
}));
// Leitura estrita (achado 4): 401/403 lança SemAcessoStatusML, falha lança, item ausente = null.
vi.mock('../../_shared/operacoes/ml-status.ts', () => {
  class SemAcessoStatusML extends Error {}
  return {
    SemAcessoStatusML,
    // A frouxa devolve null para envelope 500: o kit nunca pode usá-la (fix round 2).
    lerStatusML: async (_t: string, id: string) => { f.eventos.push(`lerStatusFrouxo:${id}`); return f.statusVivo; },
    lerStatusMLEstrito: async (_t: string, id: string) => {
      f.eventos.push(`lerStatus:${id}`);
      if (f.statusVivo === '403') throw new SemAcessoStatusML('ML 403');
      return f.statusVivo;
    },
  };
});
vi.mock('../../_shared/canais/registry.ts', () => ({
  getConnector: () => ({
    atualizarStatus: async (_c: unknown, id: string, status: string) => {
      f.eventos.push(`put:${id}:${status}`);
      // O ML aplica o PUT aceito: a leitura seguinte vê o status novo (Task 14 só apaga o registro de item lido ativo).
      if (f.put.ok) f.statusVivo = status;
      return f.put;
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => 'http://localhost' } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

beforeEach(() => {
  f.modulos = ['kit_variacao']; f.componentes = ['P1']; f.politicas = []; f.statusVivo = 'pausado';
  f.consultas = []; f.eventos = []; f.put = { ok: true };
});

const chamar = (status: 'ativo' | 'pausado') =>
  handler(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ml_item_id: 'MLB1', status }) }));
const pol = (x: Record<string, unknown>) => ({
  codigo: 'P1', estado: 'normal', versao: 2, bloqueio_operador: false, bloqueio_moderacao: false, bloqueio_retirada: false, ...x,
});

describe('atualizar-status-publicado × kit com variação', () => {
  it('Guardado: 409 pedindo para desligar "Vender só em kit", sem PUT', async () => {
    f.politicas = [pol({ estado: 'guardado' })];
    const r = await chamar('ativo');
    expect(r.status).toBe(409);
    expect((await r.json()).erro).toContain('Vender só em kit');
    expect(f.eventos.filter((e) => e.startsWith('put'))).toEqual([]);
  });

  it('moderado no ML: 409, sem PUT', async () => {
    f.statusVivo = 'moderado';
    const r = await chamar('ativo');
    expect(r.status).toBe(409);
    expect(f.eventos.filter((e) => e.startsWith('put') || e.startsWith('rpc'))).toEqual([]);
  });

  it('pausa manual grava o bloqueio do operador antes do PUT', async () => {
    const r = await chamar('pausado');
    expect(r.status).toBe(200);
    expect(f.eventos).toEqual(['rpc:kit_politica_operador:true', 'put:MLB1:pausado']);
  });

  it('o operador reativa a própria pausa: intenção, exclusão, limpa o bloqueio, PUT, confirma e libera', async () => {
    f.politicas = [pol({ bloqueio_operador: true })];
    const r = await chamar('ativo');
    expect(r.status).toBe(200);
    expect(f.eventos).toEqual([
      'lerStatus:MLB1', 'rpc:kit_ativacao_reivindicar', 'rpc:kit_adquirir_exclusao', 'rpc:kit_politica_operador:false',
      'put:MLB1:ativo', 'lerStatus:MLB1', 'rpc:kit_ativacao_liberar',
      // Task 14: reativação confirmada do operador apaga a pausa da automação deste item.
      'delete:kit_pausas_automaticas',
    ]);
  });

  it('achado 1: timeout no PUT mantém a exclusão e alerta', async () => {
    f.put = { ok: false, erro: { codigo: 'DESCONHECIDO', mensagemOperador: 'fetch failed', retentavel: false } };
    const r = await chamar('ativo');
    expect(r.status).toBe(502);
    expect(f.eventos).not.toContain('rpc:kit_ativacao_liberar');
    expect(f.eventos).toContain('alerta');
  });

  it('achado 4: 401/403 na leitura pede reconexão (não diz moderado)', async () => {
    f.statusVivo = '403';
    const r = await chamar('ativo');
    expect(r.status).toBe(409);
    expect((await r.json()).erro).toContain('Reconecte');
  });

  it('org sem o módulo: mesmas consultas de antes e PUT direto (ADR-0111 intocado)', async () => {
    f.modulos = [];
    const r = await chamar('ativo');
    expect(r.status).toBe(200);
    expect(f.consultas).toEqual(['marketplace_connections']);
    expect(f.eventos).toEqual(['put:MLB1:ativo']);
  });

  it('SKU comum em org com o módulo: PUT direto, sem RPC', async () => {
    f.componentes = [];
    const r = await chamar('ativo');
    expect(r.status).toBe(200);
    expect(f.eventos).toEqual(['put:MLB1:ativo']);
  });
});
