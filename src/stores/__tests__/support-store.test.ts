import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/suporte', () => ({
  fetchSupportContext: vi.fn(),
  startSupport: vi.fn(),
  endSupport: vi.fn(),
}));

import { useAuthStore } from '../auth-store';
import { fetchSupportContext } from '@/lib/suporte';
import { effectiveOrgId, useSupportStore } from '../support-store';

describe('support store', () => {
  beforeEach(() => {
    useAuthStore.setState({ profile: { id: 'u1', is_admin: false, is_active: true, allowed_menus: [], nome: 'Membro', org_id: 'org-member', is_super_admin: false } });
    useSupportStore.setState({ context: null, loaded: false, loading: false });
  });

  it('prioriza a organização autorizada da sessão de suporte', () => {
    useSupportStore.setState({ context: { requestId: 'r1', orgId: 'org-support', orgName: 'Cliente', scope: 'full', expiresAt: '2026-07-25T12:00:00.000Z' } });

    expect(effectiveOrgId()).toBe('org-support');
  });

  it('registra a falha de contexto como estado recuperável', async () => {
    vi.mocked(fetchSupportContext).mockRejectedValueOnce(new Error('rede indisponível'));

    await useSupportStore.getState().loadContext();

    expect(useSupportStore.getState()).toMatchObject({ context: null, loading: false, loaded: true, error: 'rede indisponível' });
  });
});
