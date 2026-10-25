import { describe, expect, it, vi } from 'vitest';

const signOutSupabase = vi.hoisted(() => vi.fn(async (_o?: unknown) => ({ error: null })));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signOut: signOutSupabase } } }));

import { signOut } from '../auth';

describe('signOut', () => {
  it('logout do app chama signOut com scope local (não revoga a sessão da extensão)', async () => {
    await signOut();
    expect(signOutSupabase).toHaveBeenCalledWith({ scope: 'local' });
  });
});
