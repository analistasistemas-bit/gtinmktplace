import { describe, it, expect } from 'vitest';
import { montarAuthUrlShopee, PATH_AUTH_PARTNER } from '../auth-url';

describe('montarAuthUrlShopee', () => {
  const host = 'https://partner.test-stable.shopeemobile.com';
  const redirect = 'https://app.example.com/shopee-oauth-callback?state=abc';

  it('monta a URL de auth_partner com os common params + redirect', () => {
    const url = montarAuthUrlShopee(host, '209920', 1700000000, 'deadbeef', redirect);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`${host}${PATH_AUTH_PARTNER}`);
    expect(u.searchParams.get('partner_id')).toBe('209920');
    expect(u.searchParams.get('timestamp')).toBe('1700000000');
    expect(u.searchParams.get('sign')).toBe('deadbeef');
  });

  it('preserva a redirect URI (com state) intacta após decode', () => {
    const url = montarAuthUrlShopee(host, '209920', 1700000000, 'sig', redirect);
    expect(new URL(url).searchParams.get('redirect')).toBe(redirect);
  });
});
