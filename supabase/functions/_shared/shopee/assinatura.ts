// Assinatura HMAC-SHA256 da Shopee Open Platform.
// Base string por tipo de API (sequência estrita), assinada com partner_key.
// Web Crypto (crypto.subtle): roda em Deno (produção) e em Node/vitest (testes).

export interface CredsAssinatura {
  partnerId: string;
  partnerKey: string;
}

const enc = new TextEncoder();

async function hmacSha256Hex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Public API: partner_id + path + timestamp. */
export function baseStringPublic(partnerId: string, path: string, timestamp: number): string {
  return `${partnerId}${path}${timestamp}`;
}

/** Shop API: partner_id + path + timestamp + access_token + shop_id. */
export function baseStringShop(
  partnerId: string,
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: string,
): string {
  return `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
}

export function assinarPublic(creds: CredsAssinatura, path: string, timestamp: number): Promise<string> {
  return hmacSha256Hex(creds.partnerKey, baseStringPublic(creds.partnerId, path, timestamp));
}

export function assinarShop(
  creds: CredsAssinatura,
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: string,
): Promise<string> {
  return hmacSha256Hex(creds.partnerKey, baseStringShop(creds.partnerId, path, timestamp, accessToken, shopId));
}
