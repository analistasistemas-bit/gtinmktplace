import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { shopeeGet, shopeePost } from '../cliente';

const creds = { partnerId: '2001887', partnerKey: 'shpk_test_key_123' };
const HOST = 'https://partner.test-stable.shopeemobile.com';

function hmacRef(key: string, msg: string): string {
  return createHmac('sha256', key).update(msg).digest('hex');
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('cliente Shopee — common params + assinatura', () => {
  it('GET public: monta partner_id/timestamp/sign corretos e o sign bate (public base string)', async () => {
    let capturada = '';
    const fetchMock = vi.fn(async (url: string) => {
      capturada = url;
      return { status: 200, json: async () => ({ ok: true }) } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const path = '/api/v2/public/get_shops_by_partner';
    const r = await shopeeGet(HOST, path, { creds });
    expect(r.status).toBe(200);

    const u = new URL(capturada);
    expect(u.origin + u.pathname).toBe(HOST + path);
    expect(u.searchParams.get('partner_id')).toBe(creds.partnerId);
    expect(u.searchParams.has('access_token')).toBe(false);

    const ts = u.searchParams.get('timestamp')!;
    const sign = u.searchParams.get('sign')!;
    const esperado = hmacRef(creds.partnerKey, `${creds.partnerId}${path}${ts}`);
    expect(sign).toBe(esperado);
  });

  it('POST shop: inclui access_token/shop_id e assina a base string shop', async () => {
    let capturada = '';
    let corpo: unknown;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      capturada = url;
      corpo = JSON.parse(init.body as string);
      return { status: 200, json: async () => ({ response: { item_id: 1 } }) } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const path = '/api/v2/product/add_item';
    await shopeePost(HOST, path, {
      creds, accessToken: 'tok123', shopId: '209920', body: { item_name: 'X' },
    });

    const u = new URL(capturada);
    expect(u.searchParams.get('access_token')).toBe('tok123');
    expect(u.searchParams.get('shop_id')).toBe('209920');
    const ts = u.searchParams.get('timestamp')!;
    const sign = u.searchParams.get('sign')!;
    const esperado = hmacRef(creds.partnerKey, `${creds.partnerId}${path}${ts}tok123209920`);
    expect(sign).toBe(esperado);
    expect(corpo).toEqual({ item_name: 'X' });
  });

  it('repassa query adicional', async () => {
    let capturada = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      capturada = url;
      return { status: 200, json: async () => ({}) } as unknown as Response;
    }));
    await shopeeGet(HOST, '/api/v2/product/get_item_base_info', {
      creds, accessToken: 't', shopId: 's', query: { item_id_list: '1,2,3' },
    });
    expect(new URL(capturada).searchParams.get('item_id_list')).toBe('1,2,3');
  });

  it('não lança em erro de negócio (HTTP 200 com error) — devolve o body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => (
      { status: 200, json: async () => ({ error: 'error_param', message: 'ruim' }) } as unknown as Response
    )));
    const r = await shopeePost(HOST, '/api/v2/product/add_item', { creds, accessToken: 't', shopId: 's', body: {} });
    expect(r.body).toEqual({ error: 'error_param', message: 'ruim' });
  });
});
