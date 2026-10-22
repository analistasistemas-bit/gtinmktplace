import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listener: null as null | ((e: AuthChangeEvent, s: Session | null) => void),
  enviar: vi.fn(async (_s: unknown) => 'ok' as const),
  perfil: { data: null as unknown, error: null },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (cb: typeof h.listener) => { h.listener = cb; },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => h.perfil }) }) }),
  },
}));
vi.mock('@/lib/query-client', () => ({ queryClient: { clear: vi.fn() } }));
vi.mock('@/lib/suporte', () => ({ endSupport: vi.fn(), fetchSupportContext: vi.fn(), startSupport: vi.fn() }));
vi.mock('@/lib/extensao-ponte', async () => {
  const { effectiveOrgId, useSupportStore } = await import('@/stores/support-store');
  return {
    enviarSessaoParaExtensao: h.enviar,
    identidadeExtensao: (s: Session) => `${s.user.id}:${effectiveOrgId() ?? ''}:${useSupportStore.getState().context?.requestId ?? ''}`,
  };
});

import { useAuthStore } from '../auth-store';
import { useSupportStore } from '../support-store';

const sessao = (token: string, user = 'u1') => ({ access_token: token, refresh_token: 'r', expires_at: 1, user: { id: user } }) as unknown as Session;
const enviados = () => h.enviar.mock.calls.map(([s]) => (s as Session | null)?.access_token ?? null);

describe('auth-store → ponte da extensão', () => {
  beforeAll(async () => { await useAuthStore.getState().hydrate(); });
  beforeEach(() => {
    h.listener!('SIGNED_OUT', null);
    useSupportStore.getState().clear();
    h.perfil = { data: null, error: null };
    h.enviar.mockClear();
  });

  it.each(['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION'] as const)('%s empurra a sessão', (evento) => {
    h.listener!(evento, sessao('a'));
    expect(enviados()).toEqual(['a']);
  });

  it('cada token novo é reenviado; o mesmo token e a mesma identidade não', () => {
    h.listener!('SIGNED_IN', sessao('a'));
    h.listener!('TOKEN_REFRESHED', sessao('b'));
    h.listener!('USER_UPDATED', sessao('b'));
    expect(enviados()).toEqual(['a', 'b']);
  });

  it('SIGNED_OUT desconecta', () => {
    h.listener!('SIGNED_IN', sessao('a'));
    h.listener!('SIGNED_OUT', null);
    expect(enviados()).toEqual(['a', null]);
  });

  it('perfil carregado (org conhecida) reenvia com a nova identidade, sem evento de auth', async () => {
    h.perfil = { data: { id: 'u1', org_id: 'org-1' }, error: null };
    h.listener!('SIGNED_IN', sessao('a'));
    await vi.waitFor(() => expect(h.enviar).toHaveBeenCalledTimes(2));
    expect(enviados()).toEqual(['a', 'a']);
  });

  it('início e fim de suporte reenviam (a org muda sem evento de auth)', () => {
    h.listener!('SIGNED_IN', sessao('a'));
    useSupportStore.setState({ context: { requestId: 'req-1', orgId: 'org-s', orgName: 'Avil', scope: 'read', expiresAt: '' } });
    useSupportStore.getState().clear();
    expect(enviados()).toEqual(['a', 'a', 'a']);
  });
});
