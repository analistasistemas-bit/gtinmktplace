// ADR-0204: edge de leitura das fotos 2 a 7 da base. Gates (admin, módulo estoque, categoria) e escopo por org.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  serve: vi.fn(),
  isAdmin: true,
  modulo: true,
  familia: { id: 'fam-1', ml_item_id: 'MLB-B', categoria_ml_id: 'MLB188064' } as Record<string, unknown> | null,
  filtros: {} as Record<string, unknown>,
  proposta: vi.fn(),
}));

vi.mock('../../_shared/cors.ts', () => ({ corsHeaders: {}, handleOptions: () => new Response() }));
vi.mock('../../_shared/auth.ts', () => ({
  requireUserOrg: vi.fn(async () => ({ userId: 'u1', orgId: 'org-1', isAdmin: f.isAdmin, support: null })),
}));
vi.mock('../../_shared/supabase.ts', () => ({
  adminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { f.filtros[c] = v; return q; },
        maybeSingle: async () => ({ data: f.familia, error: null }),
      };
      return q;
    },
  }),
}));
vi.mock('../../_shared/produto/modulo.ts', () => ({ exigirModulo: vi.fn(async () => f.modulo) }));
vi.mock('../../_shared/canais/conexao.ts', () => ({ resolverConexao: vi.fn(async () => ({ id: 'c1' })) }));
vi.mock('../../_shared/ml/token.ts', () => ({ getValidAccessTokenConexao: vi.fn(async () => 'tok') }));
vi.mock('../../_shared/kit-variacao/galeria-base.ts', async (orig) => ({
  ...(await orig<typeof import('../../_shared/kit-variacao/galeria-base.ts')>()),
  propostaGaleriaBase: f.proposta,
}));

let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal('Deno', { serve: f.serve, env: { get: () => 'http://localhost' } });
  await import('../index.ts');
  handler = f.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
});
beforeEach(() => {
  f.isAdmin = true; f.modulo = true; f.filtros = {};
  f.familia = { id: 'fam-1', ml_item_id: 'MLB-B', categoria_ml_id: 'MLB188064' };
  f.proposta.mockReset();
  f.proposta.mockResolvedValue({ fotos: [{ id: 'B2', item: 'MLB-B', url: 'u' }], avisos: [], indisponivel: false, limite: 12 });
});
const post = (body: unknown) => handler(new Request('http://localhost', { method: 'POST', headers: { Authorization: 'Bearer x' }, body: JSON.stringify(body) }));

describe('fotos-base-kit', () => {
  it('caminho feliz: escopo por org, id do item da família, categoria do kit do corpo', async () => {
    const r = await post({ familia_base_id: 'fam-1', categoria_ml_id: 'MLB999' });
    expect(r.status).toBe(200);
    expect((await r.json()).fotos).toHaveLength(1);
    expect(f.filtros.org_id).toBe('org-1');
    expect(f.proposta).toHaveBeenCalledWith({ token: 'tok', itemIdBase: 'MLB-B', categoriaKitId: 'MLB999' });
  });
  it('sem categoria no corpo usa a da família base', async () => {
    await post({ familia_base_id: 'fam-1' });
    expect(f.proposta.mock.calls[0][0].categoriaKitId).toBe('MLB188064');
  });
  it('não admin → 403', async () => { f.isAdmin = false; expect((await post({ familia_base_id: 'fam-1' })).status).toBe(403); });
  it('sem módulo estoque → 403', async () => { f.modulo = false; expect((await post({ familia_base_id: 'fam-1' })).status).toBe(403); });
  it('categoria inválida → 400', async () => { expect((await post({ familia_base_id: 'fam-1', categoria_ml_id: '../x' })).status).toBe(400); });
  it('família de outra org → 404', async () => { f.familia = null; expect((await post({ familia_base_id: 'fam-1' })).status).toBe(404); });
  it('base sem ml_item_id → fotos vazias (sem erro)', async () => {
    f.familia = { id: 'fam-1', ml_item_id: null, categoria_ml_id: 'MLB188064' };
    f.proposta.mockResolvedValue({ fotos: [], avisos: [], indisponivel: false, limite: null });
    const r = await post({ familia_base_id: 'fam-1' });
    expect(r.status).toBe(200);
    expect(f.proposta.mock.calls[0][0].itemIdBase).toBeNull();
    expect((await r.json()).fotos).toEqual([]);
  });
});
