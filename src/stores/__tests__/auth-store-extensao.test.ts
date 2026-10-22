import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  listener: null as null | ((e: AuthChangeEvent, s: Session | null) => void),
  enviar: vi.fn(async () => 'ok' as const),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (cb: typeof h.listener) => { h.listener = cb; },
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));
vi.mock('@/lib/query-client', () => ({ queryClient: { clear: vi.fn() } }));
vi.mock('@/lib/extensao-ponte', () => ({ enviarSessaoParaExtensao: h.enviar }));

import { useAuthStore } from '../auth-store';

const sessao = { access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'u1' } } as unknown as Session;

describe('auth-store → ponte da extensão', () => {
  beforeEach(async () => {
    await useAuthStore.getState().hydrate();
    h.enviar.mockClear();
  });

  it.each(['SIGNED_IN', 'TOKEN_REFRESHED', 'INITIAL_SESSION'] as const)('%s empurra a sessão', (evento) => {
    h.listener!(evento, sessao);
    expect(h.enviar).toHaveBeenCalledWith(sessao);
  });

  it('TOKEN_REFRESHED reenvia a cada renovação', () => {
    h.listener!('TOKEN_REFRESHED', sessao);
    h.listener!('TOKEN_REFRESHED', sessao);
    expect(h.enviar).toHaveBeenCalledTimes(2);
  });

  it('SIGNED_OUT desconecta', () => {
    h.listener!('SIGNED_OUT', null);
    expect(h.enviar).toHaveBeenCalledWith(null);
  });

  it('outros eventos não enviam', () => {
    h.listener!('USER_UPDATED', sessao);
    expect(h.enviar).not.toHaveBeenCalled();
  });
});
