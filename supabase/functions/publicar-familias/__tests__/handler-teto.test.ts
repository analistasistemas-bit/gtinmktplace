// ADR-0195 — fronteira real do handler: CREATE acima do teto só vai ao split com formato `legacy`
// confirmado; qualquer dúvida segue para o `publish` de hoje, sem derrubar a publicação.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Linha = Record<string, unknown>;
const f = vi.hoisted(() => ({
  serve: vi.fn(),
  create: [] as Array<Record<string, unknown>>,
  update: [] as Array<Record<string, unknown>>,
  variacoes: [] as Array<Record<string, unknown>>,
  formatos: [] as Array<Record<string, unknown>>,
  conexao: null as Record<string, unknown> | null,
  formatoErro: false,
  leituras: [] as string[],
  enfileirados: [] as Array<{ alvo: string; job: { familia_id: string } }>,
}));

function builder(tabela: string) {
  const resolver = (): { data: unknown; error: { message: string } | null } => {
    f.leituras.push(tabela);
    if (tabela === 'variacoes') return { data: f.variacoes, error: null };
    if (tabela === 'marketplace_connections') return { data: f.conexao, error: null };
    if (tabela === 'familias') return { data: [{ id: 'fam-1', categoria_ml_id: 'MLB1' }], error: null };
    if (tabela === 'ml_formato_publicacao') {
      return f.formatoErro ? { data: null, error: { message: 'fora do ar' } } : { data: f.formatos, error: null };
    }
    return { data: [], error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q, eq: () => q, in: () => q, update: () => q,
    maybeSingle: async () => resolver(),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko),
  };
  return q;
}

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn().mockResolvedValue({ userId: 'user-1', orgId: 'org-1', isAdmin: true, support: null }),
}));
vi.mock('../../_shared/support-audit.ts', () => ({ auditarOperacaoSuporte: vi.fn() }));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: (t: string) => builder(t),
    rpc: async (_n: string, a: { p_operacao: string }) => ({ data: a.p_operacao === 'CREATE' ? f.create : f.update, error: null }),
  }),
}));
vi.mock('../../_shared/queue.ts', () => ({
  garantirFilaSerial: vi.fn(async () => {}),
  enfileirarPublicacaoCanal: vi.fn(async () => 'm'),
  enfileirarPublicacoes: vi.fn(async (itens: Array<{ alvo: string; job: { familia_id: string } }>) => {
    f.enfileirados.push(...itens);
    return itens.map(() => 'm');
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => 'http://localhost' } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

const FAMILIA = { id: 'fam-1', lote_id: 'lote-1', user_id: 'user-1', codigo_pai: '000', motivo: null };
const cor = (estoque: number): Linha => ({ familia_id: 'fam-1', preco_publicacao: 10, tamanho: null, estoque });

beforeEach(() => {
  f.create = [FAMILIA]; f.update = [];
  f.variacoes = [cor(60_000), cor(60_000)];
  f.formatos = [{ categoria_id: 'MLB1', formato: 'legacy' }];
  f.conexao = { id: 'conn-1', org_id: 'org-1', canal: 'mercado_livre', conta_externa_id: 's', expires_at: null };
  f.formatoErro = false; f.leituras = []; f.enfileirados = [];
});

const publicar = async () => {
  const r = await handler(new Request('http://localhost', {
    method: 'POST', headers: { Authorization: 'Bearer x' }, body: JSON.stringify({ familia_ids: ['fam-1'] }),
  }));
  expect(r.status).toBe(200);
  return f.enfileirados.map((e) => e.alvo);
};

describe('publicar-familias — CREATE acima do teto (ADR-0195)', () => {
  it('formato legacy confirmado → split', async () => {
    expect(await publicar()).toEqual(['split']);
  });

  it('formato user_products → publish', async () => {
    f.formatos = [{ categoria_id: 'MLB1', formato: 'user_products' }];
    expect(await publicar()).toEqual(['publish']);
  });

  it('sem cache → publish', async () => {
    f.formatos = [];
    expect(await publicar()).toEqual(['publish']);
  });

  it('org sem conexão → publish', async () => {
    f.conexao = null;
    expect(await publicar()).toEqual(['publish']);
  });

  it('falha ao ler o cache → publish, com console.error', async () => {
    f.formatoErro = true;
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await publicar()).toEqual(['publish']);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it('soma dentro do limite → publish, sem ler o cache', async () => {
    f.variacoes = [cor(60_000), cor(39_999)];
    expect(await publicar()).toEqual(['publish']);
    expect(f.leituras).not.toContain('ml_formato_publicacao');
  });

  it('UPDATE acima do limite nunca lê o cache nem divide por soma', async () => {
    f.create = []; f.update = [FAMILIA];
    expect(await publicar()).toEqual(['update']);
    expect(f.leituras).not.toContain('ml_formato_publicacao');
  });
});
