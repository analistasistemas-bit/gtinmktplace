// ADR-0197 (Task 6, fix round 1): ligação real `operacoes_massa` (embed do módulo) → `kitLigado(linha)` →
// `depsStatus` → `executarStatus`. Org sem o módulo não ganha consulta nova; org com o módulo recusa Guardado.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Linha = Record<string, unknown>;
const f = vi.hoisted(() => ({
  serve: vi.fn(),
  modulos: [] as string[],
  politicas: [] as Array<Record<string, unknown>>,
  itensOp: [] as Array<Record<string, unknown>>,
  consultas: [] as string[],
  rpcs: [] as string[],
  puts: [] as string[],
}));

const VINCULOS = [{ org_id: 'O', sku: 'P1', item_externo_id: 'MLB1', catalog_listing_id: null }];

function builder(tabela: string) {
  f.consultas.push(tabela);
  const filtros: Array<(r: Linha) => boolean> = [];
  let patch: Linha | null = null;
  const linhas = (): Linha[] => {
    switch (tabela) {
      case 'operacoes_massa':
        return [{ id: 'OP', org_id: 'O', acao: 'reativar', promocao_id: null, promocao_tipo: null, status: 'executando',
          origem_id: null, organizations: { modulos_habilitados: f.modulos } }];
      case 'marketplace_connections':
        return [{ id: 'c', org_id: 'O', canal: 'mercado_livre', conta_externa_id: '1', expires_at: null }];
      case 'operacoes_massa_itens': return f.itensOp;
      case 'anuncios_externos_itens': return VINCULOS;
      case 'kit_variacao_componentes': return [{ org_id: 'O', codigo: 'P1' }];
      case 'sku_politica_kit': return f.politicas;
      default: return [];
    }
  };
  const ler = () => {
    const achadas = linhas().filter((r) => filtros.every((x) => x(r)));
    if (patch) achadas.forEach((r) => Object.assign(r, patch));
    return { data: achadas, count: achadas.length, error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q, order: () => q, limit: () => q, not: () => q, lt: () => q, gt: () => q, is: () => q,
    update: (v: Linha) => { patch = v; return q; },
    eq: (c: string, v: unknown) => { filtros.push((r) => !(c in r) || r[c] === v); return q; },
    in: (c: string, vs: unknown[]) => { filtros.push((r) => !(c in r) || vs.includes(r[c])); return q; },
    or: (expr: string) => {
      if (tabela === 'operacoes_massa_itens') filtros.push((r) => r.status === 'pendente');
      else {
        const ou = expr.split(',').map((t) => t.split('.eq.'));
        filtros.push((r) => ou.some(([c, v]) => r[c] === v));
      }
      return q;
    },
    maybeSingle: async () => { const r = ler(); return { ...r, data: r.data[0] ?? null }; },
    single: async () => { const r = ler(); return { ...r, data: r.data[0] ?? null }; },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(ler()).then(ok, ko),
  };
  return q;
}

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: (t: string) => builder(t),
    rpc: async (nome: string, args: Linha) => {
      f.rpcs.push(nome);
      if (nome === 'operacoes_massa_reivindicar') {
        const it = f.itensOp.find((i) => i.ml_item_id === args.p_ml_item && i.status === 'pendente');
        if (it) it.status = 'enviando';
        return { data: !!it, error: null };
      }
      return { data: { ok: true }, error: null };
    },
  }),
}));
vi.mock('../../_shared/queue.ts', () => ({
  verificarAssinatura: async () => true,
  qstashClient: () => ({ publishJSON: async () => ({}) }),
}));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'tok' }));
vi.mock('../../_shared/notificacoes/config.ts', () => ({ notificarCategoria: async () => {} }));
vi.mock('../../_shared/operacoes/ml-status.ts', () => ({
  SemAcessoStatusML: class extends Error {},
  lerStatusML: async () => 'pausado',
}));
vi.mock('../../_shared/canais/registry.ts', () => ({
  getConnector: () => ({
    atualizarStatus: async (_c: unknown, id: string, s: string) => { f.puts.push(`${id}:${s}`); return { ok: true }; },
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => 'http://localhost' } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

beforeEach(() => {
  f.politicas = []; f.consultas = []; f.rpcs = []; f.puts = [];
  f.itensOp = [{ org_id: 'O', operacao_id: 'OP', ml_item_id: 'MLB1', status: 'pendente', conferencias: 0, saida_pedida_em: null }];
});

const executar = () => handler(new Request('http://localhost', {
  method: 'POST', headers: { 'upstash-signature': 'x' }, body: JSON.stringify({ etapa: 'executar', operacao_id: 'OP' }),
}));
const TABELAS_KIT = ['anuncios_externos_itens', 'kit_variacao_skus', 'kit_variacao_componentes', 'sku_politica_kit', 'kit_ativacoes'];

describe('operacoes-massa: reativar × kit com variação (ligação real do módulo)', () => {
  it('org sem o módulo: nenhuma consulta nem RPC de kit; reativa como antes', async () => {
    f.modulos = [];
    const r = await executar();
    expect(r.status).toBe(200);
    expect(f.consultas.filter((t) => TABELAS_KIT.includes(t))).toEqual([]);
    expect(f.rpcs.filter((n) => n.startsWith('kit_'))).toEqual([]);
    expect(f.puts).toEqual(['MLB1:ativo']);
    expect(f.itensOp[0].status).toBe('aplicado');
  });

  it('org com o módulo: SKU Guardado fica bloqueado com o motivo, sem PUT', async () => {
    f.modulos = ['kit_variacao'];
    f.politicas = [{ org_id: 'O', codigo: 'P1', estado: 'guardado', versao: 1, bloqueio_operador: false,
      bloqueio_moderacao: false, bloqueio_retirada: false }];
    const r = await executar();
    expect(r.status).toBe(200);
    expect(f.puts).toEqual([]);
    expect(f.itensOp[0]).toMatchObject({ status: 'bloqueado', mensagem: expect.stringContaining('Vender só em kit') });
  });
});
