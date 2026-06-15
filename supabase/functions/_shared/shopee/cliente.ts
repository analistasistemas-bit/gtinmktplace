import { assinarPublic, assinarShop, type CredsAssinatura } from './assinatura.ts';

/**
 * Cliente HTTP da Shopee Open Platform. Monta os common params (partner_id,
 * timestamp, sign — e access_token/shop_id em chamadas shop-scoped), assina a
 * base string e faz o fetch.
 *
 * NÃO lança em erro de negócio: a Shopee responde HTTP 200 com
 * `{ error, message }`. Devolvemos o JSON cru para o chamador classificar
 * (ver `mapeamento.ts`). Só lança em falha de transporte (fetch rejeitado) ou
 * corpo não-JSON.
 */
export interface OpcoesShopee {
  creds: CredsAssinatura;
  accessToken?: string;
  shopId?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

export interface RespostaShopee<T = Record<string, unknown>> {
  /** HTTP status nativo (a Shopee usa 200 mesmo em erro de negócio). */
  status: number;
  /** Corpo JSON da Shopee (`{ error, message, request_id, response, ... }`). */
  body: T;
}

const enc = () => Math.floor(Date.now() / 1000);

async function montarUrl(
  host: string,
  path: string,
  opts: OpcoesShopee,
): Promise<string> {
  const timestamp = enc();
  const ehShop = !!(opts.accessToken && opts.shopId);
  const sign = ehShop
    ? await assinarShop(opts.creds, path, timestamp, opts.accessToken!, opts.shopId!)
    : await assinarPublic(opts.creds, path, timestamp);

  const params = new URLSearchParams();
  params.set('partner_id', opts.creds.partnerId);
  params.set('timestamp', String(timestamp));
  params.set('sign', sign);
  if (ehShop) {
    params.set('access_token', opts.accessToken!);
    params.set('shop_id', opts.shopId!);
  }
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) params.set(k, String(v));
  }
  return `${host}${path}?${params.toString()}`;
}

async function executar<T>(
  metodo: 'GET' | 'POST',
  host: string,
  path: string,
  opts: OpcoesShopee,
): Promise<RespostaShopee<T>> {
  const url = await montarUrl(host, path, opts);
  const init: RequestInit = { method: metodo };
  if (metodo === 'POST') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body ?? {});
  }
  const resp = await fetch(url, init);
  const body = (await resp.json().catch(() => ({}))) as T;
  return { status: resp.status, body };
}

export function shopeeGet<T = Record<string, unknown>>(
  host: string,
  path: string,
  opts: OpcoesShopee,
): Promise<RespostaShopee<T>> {
  return executar<T>('GET', host, path, opts);
}

export function shopeePost<T = Record<string, unknown>>(
  host: string,
  path: string,
  opts: OpcoesShopee,
): Promise<RespostaShopee<T>> {
  return executar<T>('POST', host, path, opts);
}
