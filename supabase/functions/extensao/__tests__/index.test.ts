// Fronteira HTTP da edge `extensao`: auditoria das escritas de vínculo em sessão de suporte (ADR-0092/0189).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Contexto = { userId: string; orgId: string; isAdmin: boolean; support: null | { requestId: string; scope: 'read' | 'full' } };

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  contexto: null as unknown as Contexto,
  ops: [] as { tabela: string; op: string; valor?: unknown }[],
  /** variação existe na org? (salvar_vinculo) */
  variacaoExiste: true,
  falharEscrita: false,
}));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({ requireUserOrg: vi.fn(async () => f.contexto) }));
vi.mock('../../_shared/produto/modulo.ts', () => ({ exigirModulo: vi.fn(async () => true) }));
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexao: vi.fn(async () => null) }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn() }));
vi.mock('../../_shared/ml/listing-prices.ts', () => ({ buscarListingPrice: vi.fn(), comissaoDeComProveniencia: vi.fn() }));
vi.mock('../../_shared/ml/frete.ts', () => ({ buscarFreteVendedorComProveniencia: vi.fn() }));
vi.mock('../../_shared/ml/http.ts', () => ({ mlGet: vi.fn() }));
vi.mock('../../_shared/redis/client.ts', () => ({ redisGet: vi.fn(), redisSet: vi.fn(), redisIncrComTTL: vi.fn(async () => 1) }));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    rpc: async () => ({ error: null }),
    from: (tabela: string) => {
      let op = 'select';
      let valor: unknown;
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        ilike: () => q,
        in: () => q,
        upsert: (v: unknown) => { op = 'upsert'; valor = v; return q; },
        insert: (v: unknown) => { op = 'insert'; valor = v; f.ops.push({ tabela, op, valor }); return Promise.resolve({ error: null }); },
        delete: () => { op = 'delete'; return q; },
        maybeSingle: () => Promise.resolve({ data: f.variacaoExiste ? { id: 'v' } : null, error: null }),
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => {
          f.ops.push({ tabela, op, valor });
          const error = f.falharEscrita ? { message: 'boom' } : null;
          const data = op === 'delete' ? [{ variacao_id: '0b7c6a2e-3c1d-4b5a-9f00-000000000002' }] : null;
          return Promise.resolve({ data, error }).then(ok, ko);
        },
      };
      return q;
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});

const VAR = '0b7c6a2e-3c1d-4b5a-9f00-000000000001';
const chave = { tipo: 'catalogo', valor: 'MLB777' };
const SALVAR = { acao: 'salvar_vinculo', chave, variacaoId: VAR };
const REMOVER = { acao: 'remover_vinculo', chave };
const post = (body: unknown) => handler(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }));
const suporte = (scope: 'read' | 'full'): Contexto => ({ userId: 'admin-1', orgId: 'org-1', isAdmin: false, support: { requestId: 'req-1', scope } });
const auditorias = () => f.ops.filter((o) => o.tabela === 'support_audit_events').map((o) => o.valor);
const escritas = () => f.ops.filter((o) => o.tabela === 'extensao_vinculos');

beforeEach(() => {
  f.ops.length = 0;
  f.variacaoExiste = true;
  f.falharEscrita = false;
  f.contexto = { userId: 'user-1', orgId: 'org-1', isAdmin: false, support: null };
});

describe('extensao — auditoria de suporte nas escritas de vínculo', () => {
  it('sem suporte: grava e não audita', async () => {
    expect((await post(SALVAR)).status).toBe(200);
    expect(escritas().map((o) => o.op)).toEqual(['upsert']);
    expect(auditorias()).toEqual([]);
  });

  it('suporte full: salvar audita ação, alvo (chave + variação) e sucesso', async () => {
    f.contexto = suporte('full');
    expect((await post(SALVAR)).status).toBe(200);
    expect(auditorias()).toEqual([{
      org_id: 'org-1', support_request_id: 'req-1', actor_id: 'admin-1', event: 'operation',
      target_type: 'extensao_vinculo:salvar', target_id: `catalogo:MLB777:${VAR}`, result: 'succeeded',
    }]);
  });

  it('suporte full: remover audita com a variação que estava vinculada', async () => {
    f.contexto = suporte('full');
    expect((await post(REMOVER)).status).toBe(200);
    expect(auditorias()).toMatchObject([{
      target_type: 'extensao_vinculo:remover', target_id: 'catalogo:MLB777:0b7c6a2e-3c1d-4b5a-9f00-000000000002', result: 'succeeded',
    }]);
  });

  it('suporte full: falha na escrita audita failed e responde interno', async () => {
    f.contexto = suporte('full');
    f.falharEscrita = true;
    const r = await post(SALVAR);
    expect(r.status).toBe(500);
    expect(auditorias()).toMatchObject([{ target_type: 'extensao_vinculo:salvar', result: 'failed' }]);
  });

  it('suporte full: variação de outra org → payload_invalido e audita failed', async () => {
    f.contexto = suporte('full');
    f.variacaoExiste = false;
    expect((await post(SALVAR)).status).toBe(400);
    expect(escritas().map((o) => o.op)).not.toContain('upsert');
    expect(auditorias()).toMatchObject([{ target_id: `catalogo:MLB777:${VAR}`, result: 'failed' }]);
  });

  it.each([['salvar', SALVAR], ['remover', REMOVER]])('suporte só leitura: %s negado (403 interno), sem escrita, auditado denied', async (acao, body) => {
    f.contexto = suporte('read');
    const r = await post(body);
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ erro: 'interno' });
    expect(escritas()).toEqual([]);
    expect(auditorias()).toMatchObject([{ target_type: `extensao_vinculo:${acao}`, target_id: acao === 'salvar' ? `catalogo:MLB777:${VAR}` : 'catalogo:MLB777', result: 'denied' }]);
  });

  it('suporte só leitura continua podendo ler (analisar não é escrita, não audita)', async () => {
    f.contexto = suporte('read');
    const r = await post({ acao: 'buscar_sku', termo: 'abc' });
    expect(r.status).toBe(200);
    expect(auditorias()).toEqual([]);
  });
});

describe('extensao — quantidade por anúncio (D-8)', () => {
  it('anúncio fora de catálogo: unidades não confirmadas (null), nunca 1', async () => {
    const r = await post({ acao: 'analisar_anuncio', tipoPagina: 'anuncio', mlItemId: 'MLB1', sellerId: '9', catalogProductId: null, categoriaId: 'MLB5', preco: 100, eanDaBusca: null });
    expect(r.status).toBe(200);
    expect((await r.json()).custo).toMatchObject({ unidadesPorPacote: null });
  });
});
