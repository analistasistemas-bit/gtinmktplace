import { adminClient } from '../supabase.ts';
import { redisSetNX, redisDel } from '../redis/client.ts';
import { precisaRenovar } from './refresh-decisao.ts';
import type { ConexaoCanal } from '../canais/conexao.ts';
import { MLApiError } from './erro-ml.ts';

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
    throw new MLApiError(resp.status, `ML /oauth/token ${resp.status}: ${await resp.text()}`);
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

async function lerTokensConexao(connectionId: string) {
  const { data, error } = await adminClient().rpc('get_connection_tokens', { p_connection_id: connectionId });
  if (error) throw new Error(`get_connection_tokens: ${error.message}`);
  const row = (data as Array<{ access_token: string; refresh_token: string; expires_at: string; conta_externa_id: string | null }>)?.[0];
  if (!row) throw new Error(`Sem conexão de canal para ${connectionId}`);
  return row;
}

async function gravarRotacaoConexao(conexao: ConexaoCanal, tok: TokenML) {
  // Preserva conta_externa_id/label/scope/criado_por existentes (refresh não os retorna).
  const { data: meta } = await adminClient()
    .from('marketplace_connections')
    .select('conta_externa_id, conta_label, scope, criado_por')
    .eq('id', conexao.id)
    .maybeSingle();
  const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();
  const { error } = await adminClient().rpc('upsert_marketplace_connection', {
    p_org_id: conexao.orgId,
    p_canal: conexao.canal,
    p_conta_externa_id: meta?.conta_externa_id ?? String(tok.user_id),
    p_conta_label: meta?.conta_label ?? null,
    p_access_token: tok.access_token,
    p_refresh_token: tok.refresh_token,
    p_scope: tok.scope ?? meta?.scope ?? null,
    p_expires_at: expiresAt,
    p_criado_por: meta?.criado_por ?? null,
  });
  if (error) throw new Error(`upsert_marketplace_connection: ${error.message}`);
}

/**
 * Retorna um access token válido para a CONEXÃO da org (E7), renovando
 * proativamente (buffer de 5 min) com lock distribuído (ADR-0012) para não
 * quebrar o refresh_token rotativo quando várias famílias rodam em paralelo.
 */
export async function getValidAccessTokenConexao(conexao: ConexaoCanal): Promise<string> {
  const row = await lerTokensConexao(conexao.id);
  if (!precisaRenovar(Date.parse(row.expires_at), Date.now(), BUFFER_MS)) {
    return row.access_token;
  }

  const lockKey = `lock:token:refresh:${conexao.id}`;
  const pegouLock = await redisSetNX(lockKey, '1', LOCK_TTL_S);

  if (pegouLock) {
    try {
      const tok = await refreshTokenML(row.refresh_token);
      // ML rotaciona o refresh_token a cada uso; se a resposta vier incompleta,
      // gravar gravaria lixo no Vault e quebraria a próxima renovação.
      if (!tok.access_token || !tok.refresh_token) {
        throw new Error('ML não retornou tokens completos na rotação');
      }
      await gravarRotacaoConexao(conexao, tok);
      return tok.access_token;
    } finally {
      await redisDel(lockKey);
    }
  }

  // Outro processo está renovando: espera o expires_at avançar e relê.
  for (let i = 0; i < REFRESH_WAIT_TRIES; i++) {
    await sleep(REFRESH_WAIT_MS);
    const r2 = await lerTokensConexao(conexao.id);
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
