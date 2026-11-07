// ADR-0197 (Task 6): pausar/reativar individual de SKU participante de kit com variação.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  modulos: [] as string[],
  componentes: [] as string[],
  politicas: [] as Array<Record<string, unknown>>,
  statusVivo: 'pausado',
  consultas: [] as string[],
  eventos: [] as string[],
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
      case 'kit_variacao_componentes': return { data: f.componentes.map((codigo) => ({ codigo })), error: null };
      case 'sku_politica_kit': return { data: f.politicas, error: null };
      default: return { data: [], error: null };
    }
  };
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, in: () => q, or: () => q,
    maybeSingle: async () => ler(),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(ler()).then(ok, ko),
  };
  return q;
}

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: (t: string) => builder(t),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      f.eventos.push(`rpc:${nome}${nome === 'kit_politica_operador' ? `:${args.p_bloquear}` : ''}`);
      return { data: { ok: true }, error: null };
    },
  }),
}));
vi.mock('../../_shared/auth.ts', () => ({ requireUserOrg: async () => ({ orgId: 'O', isAdmin: true, support: null }) }));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: async () => {} }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'tok' }));
vi.mock('../../_shared/user-products/guard-migracao-pxv.ts', () => ({ motivoMigracaoPxvPorItem: async () => null }));
vi.mock('../../_shared/canais/registry.ts', () => ({
  getConnector: () => ({
    lerStatus: async (_c: unknown, ids: string[]) => {
      f.eventos.push('lerStatus');
      return Object.fromEntries(ids.map((id) => [id, { status: f.statusVivo }]));
    },
    atualizarStatus: async (_c: unknown, id: string, status: string) => {
      f.eventos.push(`put:${id}:${status}`);
      return { ok: true };
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
  f.consultas = []; f.eventos = [];
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

  it('o operador reativa a própria pausa: exclusão, limpa o bloqueio, PUT e solta', async () => {
    f.politicas = [pol({ bloqueio_operador: true })];
    const r = await chamar('ativo');
    expect(r.status).toBe(200);
    expect(f.eventos).toEqual([
      'lerStatus', 'rpc:kit_adquirir_exclusao', 'rpc:kit_politica_operador:false', 'put:MLB1:ativo', 'rpc:kit_soltar_exclusao',
    ]);
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
