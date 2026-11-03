// ADR-0193 Fatia 2a: dados de recebimento só para super-admin ATIVO — autenticação real
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

const PROFILE = { beneficiary_name: 'Daludi Teste', document: '11222333000181', bank_name: 'Banco', branch: '0001', account: '123-4', pix_key_type: 'cnpj', pix_key: '11222333000181', city: 'Fortaleza' };
const req = (body: Record<string, unknown>) => new Request('http://local/platform-admin', { method: 'POST', body: JSON.stringify(body) });

function harness() {
  const repository = { organizationExists: vi.fn(), paymentProfile: vi.fn().mockResolvedValue(null), savePaymentProfile: vi.fn().mockResolvedValue({ ok: true }) };
  return { repository, handler: createPlatformAdminHandler({ authenticate: requirePlatformAdmin, repository }) };
}

describe('dados de recebimento — segurança', () => {
  it.each([
    ['usuário comum (admin de cliente)', { is_super_admin: false, is_active: true }],
    ['super-admin inativo', { is_super_admin: true, is_active: false }],
    ['sem perfil', null],
  ])('%s → 403 em leitura e gravação, sem tocar o repositório', async (_, profile) => {
    boundaries.requireUser.mockResolvedValue({ id: 'u1', email: null });
    boundaries.profile.mockResolvedValue({ data: profile, error: null });
    const h = harness();
    expect((await h.handler(req({ action: 'payment_profile' }))).status).toBe(403);
    expect((await h.handler(req({ action: 'save_payment_profile', ...PROFILE }))).status).toBe(403);
    expect(h.repository.paymentProfile).not.toHaveBeenCalled();
    expect(h.repository.savePaymentProfile).not.toHaveBeenCalled();
  });

  it('super-admin ativo → 200', async () => {
    boundaries.requireUser.mockResolvedValue({ id: 'u1', email: null });
    boundaries.profile.mockResolvedValue({ data: { is_super_admin: true, is_active: true }, error: null });
    const h = harness();
    expect((await h.handler(req({ action: 'payment_profile' }))).status).toBe(200);
    expect((await h.handler(req({ action: 'save_payment_profile', ...PROFILE }))).status).toBe(200);
    expect(h.repository.savePaymentProfile).toHaveBeenCalledWith('u1', PROFILE);
  });
});
