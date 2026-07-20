import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => {
  let listener: ((event: AuthChangeEvent, session: Session | null) => void) | null = null;
  return {
    get listener() { return listener; },
    setListener(value: typeof listener) { listener = value; },
    getSession: vi.fn(),
    onAuthStateChange: vi.fn((callback: typeof listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }),
    maybeSingle: vi.fn(),
  };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mocks.maybeSingle })),
      })),
    })),
  },
}));

import { useAuthStore, type Profile } from '@/stores/auth-store';

const profile = (id: string, nome: string, over: Partial<Profile> = {}): Profile => ({
  id,
  nome,
  org_id: 'org-1',
  is_admin: false,
  is_active: true,
  is_super_admin: false,
  allowed_menus: ['faturamento'],
  ...over,
});

const session = (id: string): Session => ({
  user: { id } as Session['user'],
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  token_type: 'bearer',
} as Session);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function registerAuthListener() {
  mocks.getSession.mockResolvedValueOnce({ data: { session: null } });
  await useAuthStore.getState().hydrate();
  expect(mocks.listener).not.toBeNull();
}

describe('auth-store background profile refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setListener(null);
    useAuthStore.setState({
      user: null,
      session: null,
      loading: true,
      profile: null,
      profileLoading: true,
    });
  });

  it('initial hydration remains blocking until the profile arrives', async () => {
    const currentSession = session('user-1');
    const request = deferred<{ data: Profile | null }>();
    mocks.getSession.mockResolvedValueOnce({ data: { session: currentSession } });
    mocks.maybeSingle.mockReturnValueOnce(request.promise);

    await useAuthStore.getState().hydrate();

    expect(useAuthStore.getState().profileLoading).toBe(true);
    request.resolve({ data: profile('user-1', 'Inicial') });
    await vi.waitFor(() => {
      expect(useAuthStore.getState().profile?.nome).toBe('Inicial');
    });
    expect(useAuthStore.getState().profileLoading).toBe(false);
  });

  it.each<AuthChangeEvent>(['TOKEN_REFRESHED', 'SIGNED_IN'])(
    '%s for the same user keeps the route mounted and updates the profile',
    async (event) => {
      await registerAuthListener();
      const currentSession = session('user-1');
      useAuthStore.setState({
        user: currentSession.user,
        session: currentSession,
        profile: profile('user-1', 'Antes'),
        profileLoading: false,
      });
      const request = deferred<{ data: Profile | null }>();
      mocks.maybeSingle.mockReturnValueOnce(request.promise);

      mocks.listener!(event, currentSession);

      expect(useAuthStore.getState().profileLoading).toBe(false);
      expect(useAuthStore.getState().profile?.nome).toBe('Antes');

      request.resolve({ data: profile('user-1', 'Depois', { is_active: false }) });
      await vi.waitFor(() => {
        expect(useAuthStore.getState().profile?.nome).toBe('Depois');
      });
      expect(useAuthStore.getState().profile?.is_active).toBe(false);
      expect(useAuthStore.getState().profileLoading).toBe(false);
    },
  );

  it('refreshes a loaded missing profile without blocking the route', async () => {
    await registerAuthListener();
    const currentSession = session('user-1');
    useAuthStore.setState({
      user: currentSession.user,
      session: currentSession,
      profile: null,
      profileLoading: false,
    });
    const request = deferred<{ data: Profile | null }>();
    mocks.maybeSingle.mockReturnValueOnce(request.promise);

    mocks.listener!('TOKEN_REFRESHED', currentSession);

    expect(useAuthStore.getState().profileLoading).toBe(false);
    expect(useAuthStore.getState().profile).toBeNull();

    request.resolve({ data: profile('user-1', 'Criado depois') });
    await vi.waitFor(() => {
      expect(useAuthStore.getState().profile?.nome).toBe('Criado depois');
    });
    expect(useAuthStore.getState().profileLoading).toBe(false);
  });

  it('a real user change clears the old profile and blocks until the new profile arrives', async () => {
    await registerAuthListener();
    const oldSession = session('user-1');
    const nextSession = session('user-2');
    useAuthStore.setState({
      user: oldSession.user,
      session: oldSession,
      profile: profile('user-1', 'Antigo'),
      profileLoading: false,
    });
    const request = deferred<{ data: Profile | null }>();
    mocks.maybeSingle.mockReturnValueOnce(request.promise);

    mocks.listener!('SIGNED_IN', nextSession);

    expect(useAuthStore.getState().profile).toBeNull();
    expect(useAuthStore.getState().profileLoading).toBe(true);

    request.resolve({ data: profile('user-2', 'Novo') });
    await vi.waitFor(() => {
      expect(useAuthStore.getState().profile?.id).toBe('user-2');
    });
    expect(useAuthStore.getState().profileLoading).toBe(false);
  });

  it('an obsolete profile response cannot overwrite another user or a logout', async () => {
    await registerAuthListener();
    const firstSession = session('user-1');
    useAuthStore.setState({
      user: firstSession.user,
      session: firstSession,
      profile: profile('user-1', 'Atual'),
      profileLoading: false,
    });
    const stale = deferred<{ data: Profile | null }>();
    mocks.maybeSingle.mockReturnValueOnce(stale.promise);

    mocks.listener!('TOKEN_REFRESHED', firstSession);
    mocks.listener!('SIGNED_OUT', null);
    stale.resolve({ data: profile('user-1', 'Obsoleto') });

    await Promise.resolve();
    await Promise.resolve();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().profile).toBeNull();
    expect(useAuthStore.getState().profileLoading).toBe(false);
  });

  it('an obsolete response cannot overwrite a new login for the same user', async () => {
    await registerAuthListener();
    const currentSession = session('user-1');
    useAuthStore.setState({
      user: currentSession.user,
      session: currentSession,
      profile: profile('user-1', 'Antes'),
      profileLoading: false,
    });
    const stale = deferred<{ data: Profile | null }>();
    const current = deferred<{ data: Profile | null }>();
    mocks.maybeSingle
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);

    mocks.listener!('TOKEN_REFRESHED', currentSession);
    mocks.listener!('SIGNED_OUT', null);
    mocks.listener!('SIGNED_IN', currentSession);

    current.resolve({ data: profile('user-1', 'Nova sessão') });
    await vi.waitFor(() => {
      expect(useAuthStore.getState().profile?.nome).toBe('Nova sessão');
    });

    stale.resolve({ data: profile('user-1', 'Obsoleto') });
    await Promise.resolve();
    await Promise.resolve();
    expect(useAuthStore.getState().profile?.nome).toBe('Nova sessão');
  });

  it('only the latest concurrent refresh for the same user may update the profile', async () => {
    await registerAuthListener();
    const currentSession = session('user-1');
    useAuthStore.setState({
      user: currentSession.user,
      session: currentSession,
      profile: profile('user-1', 'Antes'),
      profileLoading: false,
    });
    const older = deferred<{ data: Profile | null }>();
    const newer = deferred<{ data: Profile | null }>();
    mocks.maybeSingle
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    mocks.listener!('TOKEN_REFRESHED', currentSession);
    mocks.listener!('TOKEN_REFRESHED', currentSession);

    newer.resolve({ data: profile('user-1', 'Mais recente') });
    await vi.waitFor(() => {
      expect(useAuthStore.getState().profile?.nome).toBe('Mais recente');
    });

    older.resolve({ data: profile('user-1', 'Antigo') });
    await Promise.resolve();
    await Promise.resolve();
    expect(useAuthStore.getState().profile?.nome).toBe('Mais recente');
  });
});
