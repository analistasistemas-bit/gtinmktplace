import { adminClient } from '../supabase.ts';
import { redisSetNX, redisDel } from '../redis/client.ts';
import { precisaRenovar } from './refresh-decisao.ts';

const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const BUFFER_MS = 5 * 60 * 1000;
const LOCK_TTL_S = 30;
const REFRESH_WAIT_TRIES = 10;
const REFRESH_WAIT_MS = 300;

export interface TokenML {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  user_id: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postToken(params: Record<string, string>): Promise<TokenML> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      client_id: Deno.env.get('ML_CLIENT_ID')!,
      client_secret: Deno.env.get('ML_CLIENT_SECRET')!,
      ...params,
    }),
  });
  if (!resp.ok) {
    throw new Error(`ML /oauth/token ${resp.status}: ${await resp.text()}`);
  }
  return resp.json() as Promise<TokenML>;
}

/** Troca o `code` do callback por tokens. */
export function trocarCodePorToken(code: string): Promise<TokenML> {
  return postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: Deno.env.get('ML_REDIRECT_URI')!,
  });
}

/** Renova usando o refresh_token (rotativo: a resposta traz um novo refresh). */
export function refreshTokenML(refreshToken: string): Promise<TokenML> {
  return postToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

async function lerTokens(userId: string) {
  const { data, error } = await adminClient().rpc('get_ml_tokens', { p_user_id: userId });
  if (error) throw new Error(`get_ml_tokens: ${error.message}`);
  const row = (data as Array<{ access_token: string; refresh_token: string; expires_at: string }>)?.[0];
  if (!row) throw new Error(`Sem credenciais ML para o usuário ${userId}`);
  return row;
}

async function gravarRotacao(userId: string, tok: TokenML) {
  // Mantém ml_user_id/nickname existentes (refresh não retorna nickname).
  const { data: meta } = await adminClient()
    .from('ml_credentials')
    .select('ml_user_id, ml_nickname')
    .eq('user_id', userId)
    .maybeSingle();
  const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
  const { error } = await adminClient().rpc('upsert_ml_credentials', {
    p_user_id: userId,
    p_ml_user_id: meta?.ml_user_id ?? String(tok.user_id),
    p_ml_nickname: meta?.ml_nickname ?? null,
    p_access_token: tok.access_token,
    p_refresh_token: tok.refresh_token,
    p_scope: tok.scope ?? null,
    p_expires_at: expiresAt,
  });
  if (error) throw new Error(`upsert_ml_credentials: ${error.message}`);
}

/**
 * Retorna um access token válido para o usuário, renovando proativamente
 * (buffer de 5 min) com lock distribuído (ADR-0012) para não quebrar o
 * refresh_token rotativo quando várias famílias rodam em paralelo.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const row = await lerTokens(userId);
  if (!precisaRenovar(Date.parse(row.expires_at), Date.now(), BUFFER_MS)) {
    return row.access_token;
  }

  const lockKey = `lock:ml:refresh:${userId}`;
  const pegouLock = await redisSetNX(lockKey, '1', LOCK_TTL_S);

  if (pegouLock) {
    try {
      const tok = await refreshTokenML(row.refresh_token);
      // ML rotaciona o refresh_token a cada uso; se a resposta vier incompleta,
      // gravar gravaria lixo no Vault e quebraria a próxima renovação.
      if (!tok.access_token || !tok.refresh_token) {
        throw new Error('ML não retornou tokens completos na rotação');
      }
      await gravarRotacao(userId, tok);
      return tok.access_token;
    } finally {
      await redisDel(lockKey);
    }
  }

  // Outro processo está renovando: espera o expires_at avançar e relê.
  for (let i = 0; i < REFRESH_WAIT_TRIES; i++) {
    await sleep(REFRESH_WAIT_MS);
    const r2 = await lerTokens(userId);
    if (!precisaRenovar(Date.parse(r2.expires_at), Date.now(), BUFFER_MS)) {
      return r2.access_token;
    }
  }
  // Se o detentor do lock falhou ao gravar, o QStash re-tenta a família mais
  // tarde (tradeoço aceito do ADR-0012: a sequência ML-refresh + persistência
  // não é atômica; aqui não re-tentamos com o refresh_token possivelmente já
  // rotacionado para não invalidar a credencial).
  throw new Error('Timeout aguardando refresh de token ML (lock concorrente)');
}
