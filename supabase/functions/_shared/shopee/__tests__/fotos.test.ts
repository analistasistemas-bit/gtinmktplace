import { describe, it, expect, vi, afterEach } from 'vitest';
import { subirFotoShopee } from '../fotos';

const creds = { partnerId: '2001887', partnerKey: 'shpk_test_key_123' };
const HOST = 'https://partner.test-stable.shopeemobile.com';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('subirFotoShopee', () => {
  it('baixa a sourceUrl, faz upload multipart e retorna o image_id', async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url === 'https://storage.test/foto.jpg') {
        return { ok: true, blob: async () => new Blob(['bytes'], { type: 'image/jpeg' }) } as unknown as Response;
      }
      // upload
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(FormData);
      return {
        ok: true,
        status: 200,
        json: async () => ({ response: { image_info: { image_id: 'IMG_OK' } } }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const id = await subirFotoShopee(HOST, creds, 'tok', '209920', 'https://storage.test/foto.jpg');
    expect(id).toBe('IMG_OK');

    const uploadUrl = new URL(calls[1]);
    expect(uploadUrl.pathname).toBe('/api/v2/media_space/upload_image');
    expect(uploadUrl.searchParams.get('access_token')).toBe('tok');
    expect(uploadUrl.searchParams.get('shop_id')).toBe('209920');
    expect(uploadUrl.searchParams.get('sign')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('lança quando o download falha', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 } as unknown as Response)));
    await expect(subirFotoShopee(HOST, creds, 'tok', 's', 'https://x/y.jpg')).rejects.toThrow(/baixar/i);
  });

  it('lança quando a Shopee devolve error no upload', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('storage')) return { ok: true, blob: async () => new Blob(['b']) } as unknown as Response;
      return { ok: true, status: 200, json: async () => ({ error: 'error_image' }) } as unknown as Response;
    }));
    await expect(subirFotoShopee(HOST, creds, 'tok', 's', 'https://storage/x.jpg')).rejects.toThrow(/upload_image/i);
  });
});
