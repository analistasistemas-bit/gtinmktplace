# Task 1 Report — Preserve mounted route during same-user auth refreshes

## Status

DONE

## Files changed

- `src/stores/auth-store.ts`
- `tests/stores/auth-store.test.ts`

No protected route, menu guard, QueryClient, sales hook, or polling code was changed.

## TDD RED evidence

Command:

```bash
rtk test pnpm vitest run tests/stores/auth-store.test.ts
```

Result: exit 1; 1 test passed and 4 failed, for the expected missing behavior:

- `TOKEN_REFRESHED` same-user event set `profileLoading` to `true`.
- `SIGNED_IN` same-user event set `profileLoading` to `true`.
- A real user change retained the previous user's profile.
- A stale profile request repopulated the profile after logout.

## Minimal implementation

- Added optional `blocking` behavior to `loadProfile`.
- Kept a loaded same-user profile mounted while refreshing it in the background.
- Cleared and blocked profile loading for actual identity changes.
- Rejected profile responses when the current user no longer matches the request user.

## GREEN evidence

Targeted regression command:

```bash
rtk test pnpm vitest run tests/stores/auth-store.test.ts tests/App.test.tsx
```

Fresh final result: exit 0; 2 test files passed, 16 tests passed.

One prior combined run had a transient Dashboard timeout while showing its loading spinner (15 passed, 1 failed). The auth-store file itself passed 5/5 in that run. Repeating the exact full command passed 16/16 without code changes.

## Static verification

Command:

```bash
rtk tsc
rtk lint src/stores/auth-store.ts tests/stores/auth-store.test.ts
rtk git diff --check
```

Result: exit 0; TypeScript reported no errors, ESLint reported no issues, and the whitespace check was clean.

## Commit

- SHA: `3937fdf`
- Message: `fix(auth): preserve page state on session refresh`
- Scope: only the store change and regression test.

## Self-review

- The silent refresh invariant is exact: same user ID and a non-null loaded profile.
- Initial hydration and real user changes remain blocking.
- Logout synchronously clears user and profile state.
- An obsolete asynchronous response cannot commit across user changes or logout.
- Polling behavior and unrelated routing/data layers are untouched.
- Implementation matches the brief without extra abstractions or dependencies.

## Concerns

- The one transient `tests/App.test.tsx` Dashboard timeout described above did not reproduce on the immediate exact-command rerun.

## Luna review findings

- Critical: checking only `user.id` allows a stale response to cross A -> logout -> A or A -> B -> A.
- Important: concurrent same-user refreshes can complete out of order and let an older permissions profile overwrite the newer response.
- Important: regression tests must cover relogin with the same ID and inverse completion order for two same-user requests.
- Required correction: use a monotonic request generation/token so only the latest profile request may commit, while retaining the user-ID guard.

## Luna findings correction

### RED evidence

Command:

```bash
rtk test pnpm vitest run tests/stores/auth-store.test.ts
```

Result: exit 1; both new regression tests failed for the expected stale-write
behavior:

- expected `Nova sessão`, received `Obsoleto` after A -> logout -> A;
- expected `Mais recente`, received `Antigo` when concurrent same-user requests
  completed in inverse order.

### GREEN evidence

Added a monotonic profile request generation. A response now commits only when
both its generation is current and its user ID still matches the active user.

Files:

- `src/stores/auth-store.ts`
- `tests/stores/auth-store.test.ts`

Commands and results:

```bash
rtk test pnpm vitest run tests/stores/auth-store.test.ts tests/App.test.tsx
# exit 0; 2 files passed, 18 tests passed

rtk tsc
# exit 0; no TypeScript errors

rtk lint src/stores/auth-store.ts tests/stores/auth-store.test.ts
# exit 0; no ESLint issues

rtk git diff --check
# exit 0; clean
```

Correction commit: `fa18ec1`
