import { describe, expect, it, vi, beforeEach } from 'vitest';

// ADR-0171 — renovarTokenConexao: mesmo lock do ADR-0012, mas relê o token depois de pegar o
// lock e só renova se ainda estiver dentro do limite (a conexão pode já ter sido renovada por
// outro caminho entre a listagem que a escolheu e agora).
const redisSetNX = vi.fn();
const redisDel = vi.fn();
vi.mock('../../redis/client.ts', () => ({
  redisSetNX: (...args: unknown[]) => redisSetNX(...args),
  redisDel: (...args: unknown[]) => redisDel(...args),
}));

const rpcMock = vi.fn();
const maybeSingleMock = vi.fn();
vi.mock('../../supabase.ts', () => ({
  adminClient: () => ({
    rpc: (nome: string, params: Record<string, unknown>) => rpcMock(nome, params),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }),
  }),
}));

const { renovarTokenConexao } = await import('../token.ts');

const conexao = { id: 'conn-1', orgId: 'org-1', canal: 'mercado_livre', contaExternaId: '999', expiresAt: null };
const LIMITE_MS = 165 * 60_000;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Deno', { env: { get: (k: string) => ({ ML_CLIENT_ID: 'cid', ML_CLIENT_SECRET: 'csecret' } as Record<string, string>)[k] } });
  maybeSingleMock.mockResolvedValue({
    data: { conta_externa_id: '999', conta_label: null, scope: null, criado_por: null, me2_habilitado: null },
    error: null,
  });
});

describe('renovarTokenConexao (ADR-0171)', () => {
  it('sem lock: pulado_lock, sem chamar o ML', async () => {
    redisSetNX.mockResolvedValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r = await renovarTokenConexao(conexao, LIMITE_MS);

    expect(r).toBe('pulado_lock');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
    expect(redisDel).not.toHaveBeenCalled();
  });

  it('com lock, mas relido fora do limite: pulado_fora_limite, sem chamar o ML, com redisDel', async () => {
    redisSetNX.mockResolvedValue(true);
    rpcMock.mockImplementation((nome: string) => {
      if (nome === 'get_connection_tokens') {
        return Promise.resolve({
          data: [{
            access_token: 'a', refresh_token: 'r',
            expires_at: new Date(Date.now() + 200 * 60_000).toISOString(), conta_externa_id: '999',
          }],
          error: null,
        });
      }
      throw new Error(`rpc inesperada: ${nome}`);
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r = await renovarTokenConexao(conexao, LIMITE_MS);

    expect(r).toBe('pulado_fora_limite');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(redisDel).toHaveBeenCalledWith('lock:token:refresh:conn-1');
  });

  it('com lock e dentro do limite: renova, grava a rotação e libera o lock', async () => {
    redisSetNX.mockResolvedValue(true);
    const upserts: Record<string, unknown>[] = [];
    rpcMock.mockImplementation((nome: string, params: Record<string, unknown>) => {
      if (nome === 'get_connection_tokens') {
        return Promise.resolve({
          data: [{
            access_token: 'token-antigo', refresh_token: 'refresh-antigo',
            expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), conta_externa_id: '999',
          }],
          error: null,
        });
      }
      if (nome === 'upsert_marketplace_connection') {
        upserts.push(params);
        return Promise.resolve({ data: 'conn-1', error: null });
      }
      throw new Error(`rpc inesperada: ${nome}`);
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'token-novo', refresh_token: 'refresh-novo', expires_in: 21600, user_id: 999,
    }), { status: 200 })));

    const r = await renovarTokenConexao(conexao, LIMITE_MS);

    expect(r).toBe('renovado');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].p_access_token).toBe('token-novo');
    expect(upserts[0].p_refresh_token).toBe('refresh-novo');
    expect(redisDel).toHaveBeenCalledWith('lock:token:refresh:conn-1');
  });

  it('erro do ML propaga e ainda assim libera o lock (finally)', async () => {
    redisSetNX.mockResolvedValue(true);
    rpcMock.mockImplementation((nome: string) => {
      if (nome === 'get_connection_tokens') {
        return Promise.resolve({
          data: [{
            access_token: 'a', refresh_token: 'r',
            expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), conta_externa_id: '999',
          }],
          error: null,
        });
      }
      throw new Error(`rpc inesperada: ${nome}`);
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"rate_limit"}', { status: 429 })));

    await expect(renovarTokenConexao(conexao, LIMITE_MS)).rejects.toThrow(/429/);
    expect(redisDel).toHaveBeenCalledWith('lock:token:refresh:conn-1');
  });
});
