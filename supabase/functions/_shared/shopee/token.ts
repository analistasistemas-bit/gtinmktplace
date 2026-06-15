import { adminClient } from '../supabase.ts';
import { redisSetNX, redisDel } from '../redis/client.ts';
import { precisaRenovar } from '../ml/refresh-decisao.ts';
import { shopeePost } from './cliente.ts';
import type { CredsAssinatura } from './assinatura.ts';

// Espelha _shared/ml/token.ts (ADR-0012): refresh proativo com lock Redis para
// não corromper o refresh_token rotativo quando várias famílias rodam em paralelo.
const BUFFER_MS = 5 * 60 * 1000;
const LOCK_TTL_S = 30;
const REFRESH_WAIT_TRIES = 10;
const REFRESH_WAIT_MS = 300;

const PATH_TOKEN_GET = '/api/v2/auth/token/get';
const PATH_ACCESS_TOKEN_GET = '/api/v2/auth/access_token/get';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TokenShopee {
  access_token: string;
  refresh_token: string;
  expire_in: number; // segundos (campo nativo da Shopee)
}

function host(): string {
  return Deno.env.get('SHOPEE_HOST')!;
}

function creds(): CredsAssinatura {
  return {
    partnerId: Deno.env.get('SHOPEE_PARTNER_ID')!,
    partnerKey: Deno.env.get('SHOPEE_PARTNER_KEY')!,
  };
}

/** Troca o `code` do callback OAuth por tokens (public; sem access_token ainda). */
export async function trocarCodePorToken(code: string, shopId: string): Promise<TokenShopee> {
  const { status, body } = await shopeePost<TokenShopee & { error?: string; message?: string }>(
    host(),
    PATH_TOKEN_GET,
    { creds: creds(), body: { code, shop_id: Number(shopId), partner_id: Number(creds().partnerId) } },
  );
  if (body?.error || !body?.access_token) {
    throw new Error(`Shopee token/get (${status}): ${body?.message || body?.error || 'sem access_token'}`);
  }
  return body;
}

/** Renova usando o refresh_token (public). A Shopee pode rotacionar o refresh. */
export async function refreshTokenShopee(refreshToken: string, shopId: string): Promise<TokenShopee> {
  const { status, body } = await shopeePost<TokenShopee & { error?: string; message?: string }>(
    host(),
    PATH_ACCESS_TOKEN_GET,
    { creds: creds(), body: { refresh_token: refreshToken, shop_id: Number(shopId), partner_id: Number(creds().partnerId) } },
  );
  if (body?.error || !body?.access_token) {
    throw new Error(`Shopee access_token/get (${status}): ${body?.message || body?.error || 'sem access_token'}`);
  }
  return body;
}

async function lerTokens(userId: string) {
  const { data, error } = await adminClient().rpc('get_shopee_tokens', { p_user_id: userId });
  if (error) throw new Error(`get_shopee_tokens: ${error.message}`);
  const row = (data as Array<{ access_token: string; refresh_token: string; shop_id: string; expires_at: string }>)?.[0];
  if (!row) throw new Error(`Sem credenciais Shopee para o usuário ${userId}`);
  return row;
}

/** shop_id da credencial Shopee do usuário (canal shop-scoped). Lança sem credencial. */
export async function getShopId(userId: string): Promise<string> {
  const row = await lerTokens(userId);
  return row.shop_id;
}

async function gravarRotacao(userId: string, shopId: string, tok: TokenShopee) {
  const expiresAt = new Date(Date.now() + tok.expire_in * 1000).toISOString();
  const { error } = await adminClient().rpc('upsert_shopee_credentials', {
    p_user_id: userId,
    p_shop_id: shopId,
    p_access_token: tok.access_token,
    p_refresh_token: tok.refresh_token,
    p_expires_at: expiresAt,
  });
  if (error) throw new Error(`upsert_shopee_credentials: ${error.message}`);
}

/**
 * Retorna um access token válido para o usuário, renovando proativamente
 * (buffer de 5 min) sob lock distribuído (ADR-0012). O lock protege contra
 * corrida de refresh quando várias famílias rodam em paralelo.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const row = await lerTokens(userId);
  if (!precisaRenovar(Date.parse(row.expires_at), Date.now(), BUFFER_MS)) {
    return row.access_token;
  }

  const lockKey = `lock:shopee:refresh:${userId}`;
  const pegouLock = await redisSetNX(lockKey, '1', LOCK_TTL_S);

  if (pegouLock) {
    try {
      const tok = await refreshTokenShopee(row.refresh_token, row.shop_id);
      if (!tok.access_token || !tok.refresh_token) {
        throw new Error('Shopee não retornou tokens completos na rotação');
      }
      await gravarRotacao(userId, row.shop_id, tok);
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
  throw new Error('Timeout aguardando refresh de token Shopee (lock concorrente)');
}
