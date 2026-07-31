import { describe, expect, it, vi } from 'vitest';

// Regressão: gravarRotacaoConexao (rodada a cada refresh de token, ~6h) precisa
// preservar me2_habilitado — sem reler e repassar, upsert_marketplace_connection
// sobrescrevia a coluna com null em TODO refresh (ADR-0095 ficava sempre stale).
const upsertChamadas: Array<Record<string, unknown>> = [];

vi.mock('../../supabase.ts', () => ({
  adminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: {
            conta_externa_id: '9757132', conta_label: null, scope: 'read',
            criado_por: 'user-1', me2_habilitado: true,
          },
          error: null,
        }),
      };
      return query;
    },
    rpc: (nome: string, params: Record<string, unknown>) => {
      if (nome === 'get_connection_tokens') {
        return Promise.resolve({
          data: [{
            access_token: 'token-antigo', refresh_token: 'refresh-antigo',
            expires_at: new Date(0).toISOString(), conta_externa_id: '9757132',
          }],
          error: null,
        });
      }
      if (nome === 'upsert_marketplace_connection') {
        upsertChamadas.push(params);
        return Promise.resolve({ data: 'conn-1', error: null });
      }
      throw new Error(`rpc inesperada: ${nome}`);
    },
  }),
}));
vi.mock('../../redis/client.ts', () => ({
  redisSetNX: vi.fn().mockResolvedValue(true),
  redisDel: vi.fn().mockResolvedValue(undefined),
}));

const { getValidAccessTokenConexao } = await import('../token.ts');

describe('getValidAccessTokenConexao — refresh preserva me2_habilitado', () => {
  it('repassa o me2_habilitado existente pro upsert em vez de deixar cair no default null', async () => {
    vi.stubGlobal('Deno', { env: { get: (k: string) => ({ ML_CLIENT_ID: 'cid', ML_CLIENT_SECRET: 'csecret' } as Record<string, string>)[k] } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'token-novo', refresh_token: 'refresh-novo', expires_in: 21600, user_id: 9757132,
    }), { status: 200 })));

    await getValidAccessTokenConexao({
      id: 'conn-1', orgId: 'org-1', canal: 'mercado_livre', contaExternaId: '9757132', expiresAt: null,
    });

    expect(upsertChamadas).toHaveLength(1);
    expect(upsertChamadas[0].p_me2_habilitado).toBe(true);
  });
});
