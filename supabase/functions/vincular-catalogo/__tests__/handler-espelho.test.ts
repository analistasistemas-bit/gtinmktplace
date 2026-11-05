// ADR-0195 — fronteira real do worker: o espelho do catálogo não reinsere na partição 0 os SKUs que
// vivem em outra partição.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  particoes: [] as Array<Record<string, unknown>>,
  particoesErro: false,
  espelhos: [] as Array<Array<{ codigo: string }>>,
}));

const VARIACOES = [
  { codigo: 'A', cor: 'Azul', ml_variation_id: '1' },
  { codigo: 'B', cor: 'Rosa', ml_variation_id: '2' },
];

function builder(tabela: string) {
  const resolver = (): { data: unknown; error: { message: string } | null } => {
    if (tabela === 'familias') {
      return { data: { user_id: 'u', org_id: 'org-1', codigo_pai: '000', ml_item_id: 'MLB1' }, error: null };
    }
    if (tabela === 'variacoes') return { data: VARIACOES, error: null };
    if (tabela === 'anuncios_externos') {
      return f.particoesErro ? { data: null, error: { message: 'fora do ar' } } : { data: f.particoes, error: null };
    }
    return { data: [], error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, in: () => q,
    single: async () => resolver(),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko),
  };
  return q;
}

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/supabase.ts', () => ({ adminClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('../../_shared/queue.ts', () => ({
  verificarAssinatura: async () => true, enfileirarVinculacaoCatalogo: vi.fn(), qstashClient: vi.fn(),
}));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: async () => 'tok' }));
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexao: async () => ({ id: 'conn-1' }) }));
vi.mock('../../_shared/notificacoes/config.ts', () => ({ notificarCategoria: vi.fn(async () => 0) }));
vi.mock('../../_shared/anuncios/espelhar.ts', () => ({
  espelharAnuncioExterno: async (_a: unknown, _f: unknown, vars: Array<{ codigo: string }>) => { f.espelhos.push(vars); },
}));
vi.mock('../vinculacao.ts', async (original) => ({
  ...(await original<typeof import('../vinculacao')>()),
  rodarVinculacaoCatalogo: async () => ({ tipo: 'legacy', resumo: {} }),
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => 'http://localhost' } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

beforeEach(() => { f.particoes = []; f.particoesErro = false; f.espelhos = []; });

const rodar = async () => {
  const r = await handler(new Request('http://localhost', { method: 'POST', body: JSON.stringify({ familia_id: 'fam-1' }) }));
  expect(r.status).toBe(200);
  return f.espelhos.map((vars) => vars.map((v) => v.codigo));
};

describe('vincular-catalogo — espelho na partição 0 (ADR-0195)', () => {
  it('família de 1 partição espelha todas as variações', async () => {
    f.particoes = [{ particao: 0, variacoes_externas: { A: {} } }];
    expect(await rodar()).toEqual([['A', 'B']]);
  });

  it('família com 2 partições espelha só o mapa da partição 0', async () => {
    f.particoes = [{ particao: 0, variacoes_externas: { A: {} } }, { particao: 1, variacoes_externas: { B: {} } }];
    expect(await rodar()).toEqual([['A']]);
  });

  it('sem ler as partições não espelha: poluir o mapa é pior que atrasar o espelho', async () => {
    f.particoesErro = true;
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await rodar()).toEqual([]);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});
