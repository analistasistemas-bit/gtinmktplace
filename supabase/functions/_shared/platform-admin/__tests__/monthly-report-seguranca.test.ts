// ADR-0193 Fatia 1, tarefa 6: a ação monthly_report só responde a super-admin ATIVO — autenticação real
// (requirePlatformAdmin) ligada ao handler; o repositório nunca é chamado nos casos recusados.
import { describe, expect, it, vi } from 'vitest';

const boundaries = vi.hoisted(() => ({ requireUser: vi.fn(), profile: vi.fn() }));
vi.mock('../../auth.ts', () => ({ requireUser: boundaries.requireUser }));
vi.mock('../../supabase.ts', () => ({
  adminClient: () => ({
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: boundaries.profile };
      return query;
    },
  }),
}));

const { requirePlatformAdmin } = await import('../auth.ts');
const { createPlatformAdminHandler } = await import('../handler.ts');

const ORG = '90000000-0000-0000-0000-000000000001';
const req = () => new Request('http://local/platform-admin', {
  method: 'POST', body: JSON.stringify({ action: 'monthly_report', org_id: ORG, month: '2026-10' }),
});

function harness() {
  const repository = { organizationExists: vi.fn().mockResolvedValue(true), monthlyReport: vi.fn().mockResolvedValue({ ok: true }) };
  return { repository, handler: createPlatformAdminHandler({ authenticate: requirePlatformAdmin, repository }) };
}

describe('monthly_report — segurança', () => {
  it.each([
    ['usuário comum (admin de cliente)', { is_super_admin: false, is_active: true }],
    ['super-admin inativo', { is_super_admin: true, is_active: false }],
    ['sem perfil', null],
  ])('%s → 403 e nenhuma leitura', async (_, profile) => {
    boundaries.requireUser.mockResolvedValue({ id: 'u1', email: null });
    boundaries.profile.mockResolvedValue({ data: profile, error: null });
    const h = harness();
    expect((await h.handler(req())).status).toBe(403);
    expect(h.repository.organizationExists).not.toHaveBeenCalled();
    expect(h.repository.monthlyReport).not.toHaveBeenCalled();
  });

  it('super-admin ativo → 200', async () => {
    boundaries.requireUser.mockResolvedValue({ id: 'u1', email: null });
    boundaries.profile.mockResolvedValue({ data: { is_super_admin: true, is_active: true }, error: null });
    const h = harness();
    expect((await h.handler(req())).status).toBe(200);
    expect(h.repository.monthlyReport).toHaveBeenCalledWith('u1', ORG, '2026-10');
  });
});
