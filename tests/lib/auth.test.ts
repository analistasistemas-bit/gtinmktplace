import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signIn, signUp, signOut, sendPasswordReset } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      resetPasswordForEmail: vi.fn(),
    },
  },
}));

describe('lib/auth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('signIn calls signInWithPassword and returns user on success', async () => {
    const user = { id: 'u1', email: 'a@b.co' };
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user, session: { access_token: 't' } } as any,
      error: null,
    });
    const result = await signIn('a@b.co', 'pw');
    expect(result.user).toEqual(user);
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.co',
      password: 'pw',
    });
  });

  it('signIn throws when supabase returns error', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: { user: null, session: null } as any,
      error: { message: 'Invalid login', name: 'AuthApiError', status: 400 } as any,
    });
    await expect(signIn('a@b.co', 'wrong')).rejects.toThrow('Invalid login');
  });

  it('signUp passes email/password to supabase', async () => {
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: { user: { id: 'u2' } as any, session: null },
      error: null,
    });
    await signUp('new@b.co', 'pw12345678');
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: 'new@b.co',
      password: 'pw12345678',
    });
  });

  it('signOut calls supabase signOut', async () => {
    vi.mocked(supabase.auth.signOut).mockResolvedValue({ error: null });
    await signOut();
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it('sendPasswordReset calls resetPasswordForEmail', async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({
      data: {},
      error: null,
    } as any);
    await sendPasswordReset('a@b.co');
    expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co');
  });
});
