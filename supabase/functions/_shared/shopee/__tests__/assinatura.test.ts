import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { baseStringPublic, baseStringShop, assinarPublic, assinarShop } from '../assinatura';

const creds = { partnerId: '2001887', partnerKey: 'shpk_test_key_123' };

function hmacRef(key: string, msg: string): string {
  return createHmac('sha256', key).update(msg).digest('hex');
}

describe('base string', () => {
  it('public = partner_id + path + timestamp', () => {
    expect(baseStringPublic('2001887', '/api/v2/public/get_shops_by_partner', 1655714431))
      .toBe('2001887/api/v2/public/get_shops_by_partner1655714431');
  });

  it('shop = partner_id + path + timestamp + access_token + shop_id', () => {
    expect(baseStringShop('2001887', '/api/v2/product/add_item', 1655714431, 'tok', '209920'))
      .toBe('2001887/api/v2/product/add_item1655714431tok209920');
  });
});

describe('assinatura HMAC-SHA256 hex', () => {
  it('public confere com a referência node:crypto', async () => {
    const path = '/api/v2/auth/token/get';
    const ts = 1700000000;
    const sign = await assinarPublic(creds, path, ts);
    expect(sign).toBe(hmacRef(creds.partnerKey, baseStringPublic(creds.partnerId, path, ts)));
    expect(sign).toMatch(/^[0-9a-f]{64}$/);
  });

  it('shop confere com a referência node:crypto', async () => {
    const path = '/api/v2/product/add_item';
    const ts = 1700000000;
    const sign = await assinarShop(creds, path, ts, 'access123', '209920');
    expect(sign).toBe(hmacRef(creds.partnerKey, baseStringShop(creds.partnerId, path, ts, 'access123', '209920')));
  });

  it('chaves diferentes geram assinaturas diferentes', async () => {
    const a = await assinarPublic(creds, '/p', 1);
    const b = await assinarPublic({ ...creds, partnerKey: 'outro' }, '/p', 1);
    expect(a).not.toBe(b);
  });
});
