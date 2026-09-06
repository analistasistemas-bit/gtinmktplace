import { describe, expect, it, vi } from 'vitest';

const boundaries = vi.hoisted(() => ({
  requireUser: vi.fn(),
  profile: vi.fn(),
}));

vi.mock('../../auth.ts', () => ({ requireUser: boundaries.requireUser }));
vi.mock('../../supabase.ts', () => ({
  adminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: boundaries.profile,
      };
      return query;
    },
  }),
}));

const { requirePlatformAdmin } = await import('../auth.ts');

describe('requirePlatformAdmin', () => {
  it('aceita super-admin com perfil ativo', async () => {
    boundaries.requireUser.mockResolvedValue({ id: 'actor-1', email: null });
    boundaries.profile.mockResolvedValue({ data: { is_super_admin: true, is_active: true }, error: null });

    await expect(requirePlatformAdmin(new Request('http://localhost'))).resolves.toEqual({ userId: 'actor-1' });
  });

  it('recusa super-admin com perfil inativo', async () => {
    boundaries.requireUser.mockResolvedValue({ id: 'actor-1', email: null });
    boundaries.profile.mockResolvedValue({ data: { is_super_admin: true, is_active: false }, error: null });

    await expect(requirePlatformAdmin(new Request('http://localhost'))).rejects.toMatchObject({ status: 403 });
  });

  it('recusa admin de cliente', async () => {
    boundaries.requireUser.mockResolvedValue({ id: 'actor-1', email: null });
    boundaries.profile.mockResolvedValue({ data: { is_super_admin: false, is_active: true }, error: null });

    await expect(requirePlatformAdmin(new Request('http://localhost'))).rejects.toMatchObject({ status: 403 });
  });

  it('propaga ausência de JWT', async () => {
    boundaries.requireUser.mockRejectedValue(new Response('Missing bearer token', { status: 401 }));

    await expect(requirePlatformAdmin(new Request('http://localhost'))).rejects.toMatchObject({ status: 401 });
  });
});
