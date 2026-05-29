import { describe, it, expect } from 'vitest';
import { montarAuthUrl } from '../auth-url';

describe('montarAuthUrl', () => {
  it('monta a URL de autorização do ML Brasil com os params certos', () => {
    const url = montarAuthUrl('abc-123', 'CLIENT_X', 'https://x.supabase.co/functions/v1/ml-oauth-callback');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://auth.mercadolivre.com.br/authorization');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('CLIENT_X');
    expect(u.searchParams.get('redirect_uri')).toBe('https://x.supabase.co/functions/v1/ml-oauth-callback');
    expect(u.searchParams.get('state')).toBe('abc-123');
  });
});
