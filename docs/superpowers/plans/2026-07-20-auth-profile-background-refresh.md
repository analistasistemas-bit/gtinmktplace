# Silent Auth Profile Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atualizar o perfil silenciosamente em eventos repetidos de autenticação para preservar filtros e rascunhos locais ao voltar para a aba do PubliAI.

**Architecture:** O `auth-store` continuará sendo a única fonte de sessão e perfil. Eventos para um usuário novo ou ainda sem perfil usam carregamento bloqueante; eventos repetidos para o mesmo usuário mantêm o perfil e o `Outlet` montados enquanto uma consulta silenciosa atualiza permissões em segundo plano. Uma guarda de identidade impede que uma resposta antiga sobrescreva o perfil de outro usuário ou de uma sessão encerrada.

**Tech Stack:** React 18, TypeScript 5.7, Zustand 4, Supabase JS 2, Vitest 3.

## Global Constraints

- Correção na worktree `fix/auth-profile-background-refresh`; nunca implementar diretamente em `main`.
- Não alterar polling, `refetchOnWindowFocus`, telas de faturamento, filtros ou formulários.
- Não adicionar dependências nem persistência em URL, storage ou store global.
- Atualizações de permissão e desativação devem continuar chegando pela consulta de `profiles`.
- Uma resposta assíncrona de perfil nunca pode ser aplicada a outro usuário ou após logout.
- Preservar os arquivos e mudanças das demais worktrees.
- Todos os comandos shell devem usar o prefixo `rtk`.

## File Structure

- Modify: `src/stores/auth-store.ts` — distinguir primeiro carregamento/troca de identidade de atualizações silenciosas e rejeitar respostas obsoletas.
- Create: `tests/stores/auth-store.test.ts` — reproduzir eventos de foco/renovação, troca de usuário e corrida assíncrona no limite Supabase/store.
- Existing, no change: `src/components/protected-route.tsx` and `src/components/menu-guard.tsx` — deixam de desmontar a rota porque `profileLoading` permanece `false`; seus controles de acesso continuam intactos.

---

### Task 1: Preserve the mounted route during same-user auth refreshes

**Owner:** Terra (`gpt-5.6-terra`) implements with TDD. Luna (`gpt-5.6-luna`) reviews only after Terra's commit. Sol coordinates, integrates and performs the final verification.

**Files:**
- Create: `tests/stores/auth-store.test.ts`
- Modify: `src/stores/auth-store.ts`

**Interfaces:**
- Consumes: `supabase.auth.getSession()`, `supabase.auth.onAuthStateChange()`, `supabase.from('profiles')`.
- Produces: `loadProfile(userId: string, options?: { blocking?: boolean }): Promise<void>`.
- Invariant: an auth event is silent only when `nextUser.id === currentUser.id` and a profile is already loaded.
- Invariant: a profile response is committed only while `get().user?.id === userId`.

- [ ] **Step 1: Create the failing regression tests**

Create `tests/stores/auth-store.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the regression tests and confirm RED**

Run:

```bash
rtk test pnpm vitest run tests/stores/auth-store.test.ts
```

Expected: FAIL because the current same-user callback sets `profileLoading` to `true`, and the obsolete request can repopulate `profile` after logout.

- [ ] **Step 3: Implement the minimum identity-aware refresh**

Update the relevant interface and store initializer in `src/stores/auth-store.ts`:

```ts
interface LoadProfileOptions {
  blocking?: boolean;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  profileLoading: boolean;
  hydrate: () => Promise<void>;
  setSession: (s: Session | null) => void;
  loadProfile: (userId: string, options?: LoadProfileOptions) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: true,
  profile: null,
  profileLoading: true,
  hydrate: async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    set({ session: data.session, user, loading: false });
    if (user) {
      void get().loadProfile(user.id);
    } else {
      set({ profile: null, profileLoading: false });
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      const previousUserId = get().user?.id ?? null;
      const user = session?.user ?? null;
      if (!user) {
        set({ session, user: null, profile: null, profileLoading: false });
        return;
      }

      const sameLoadedUser = previousUserId === user.id && get().profile !== null;
      if (sameLoadedUser) {
        set({ session, user });
      } else {
        set({ session, user, profile: null });
      }
      void get().loadProfile(user.id, { blocking: !sameLoadedUser });
    });
  },
  setSession: (session) => set({ session, user: session?.user ?? null }),
  loadProfile: async (userId, options = {}) => {
    const blocking = options.blocking ?? true;
    if (blocking) set({ profileLoading: true });
    const { data } = await supabase
      .from('profiles')
      .select('id,is_admin,is_active,allowed_menus,nome,org_id,is_super_admin')
      .eq('id', userId)
      .maybeSingle();
    if (get().user?.id !== userId) return;
    set({ profile: (data as Profile) ?? null, profileLoading: false });
  },
}));
```

Do not modify `ProtectedRoute`, `MenuGuard`, the QueryClient, or sales hooks. They already behave correctly when `profileLoading` is not toggled during a same-user refresh.

- [ ] **Step 4: Run the targeted tests and confirm GREEN**

Run:

```bash
rtk test pnpm vitest run tests/stores/auth-store.test.ts tests/App.test.tsx
```

Expected: 2 test files pass; the new auth-store tests demonstrate silent same-user updates, blocking identity changes and rejection of stale responses.

- [ ] **Step 5: Run targeted static verification**

Run:

```bash
rtk tsc
rtk lint src/stores/auth-store.ts tests/stores/auth-store.test.ts
rtk git diff --check
```

Expected: all commands exit 0 with no TypeScript, lint or whitespace errors.

- [ ] **Step 6: Commit the independently testable fix**

Run:

```bash
rtk git add src/stores/auth-store.ts tests/stores/auth-store.test.ts
rtk git commit -m "fix(auth): preserve page state on session refresh"
```

Expected: one commit containing only the store change and its regression tests.

## Orchestration and review gates

1. Sol dispatches Task 1 to one Terra executor after plan approval; no parallel writer is needed because production code and tests share one stateful boundary.
2. Sol checks the commit and targeted test artifacts.
3. Sol dispatches one Luna reviewer for two passes: specification/security correctness, then a delete-list for unnecessary code.
4. Critical or Important findings return to a fresh Terra fixer; Luna re-reviews the correction.
5. Sol runs the Sentinel Verify phase, then integrates only after all required artifacts pass.

## Plan self-review

- Spec coverage: every design requirement maps to Task 1; no gaps found.
- Placeholder scan: nenhum marcador ou passo de implementação adiado encontrado.
- Type consistency: `LoadProfileOptions`, `loadProfile(userId, options)` and the same-user identity rule are consistent across tests and implementation.
- Scope check: one store boundary and one test file; splitting into more implementation tasks would create artificial dependencies.
