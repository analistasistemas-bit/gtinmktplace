import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/suporte', () => ({
  fetchSupportContext: vi.fn(),
  startSupport: vi.fn(),
  endSupport: vi.fn(),
}));
const qc = vi.hoisted(() => ({ clear: vi.fn() }));
vi.mock('@/lib/query-client', () => ({ queryClient: qc }));

import { useAuthStore } from '../auth-store';
import { endSupport, fetchSupportContext, startSupport } from '@/lib/suporte';
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

  // Org efetiva muda ao entrar/sair do suporte: cache de outra org (inclusive resposta pendente) não pode
  // montar a tela nova. Mesmo padrão da troca de usuário no auth-store.
  it('entrar no suporte limpa o cache antes de carregar o contexto da org nova', async () => {
    qc.clear.mockClear();
    const ordem: string[] = [];
    vi.mocked(startSupport).mockImplementationOnce(async () => { ordem.push('start'); return {} as never; });
    qc.clear.mockImplementation(() => { ordem.push('clear'); });
    vi.mocked(fetchSupportContext).mockImplementationOnce(async () => { ordem.push('contexto'); return null; });

    await useSupportStore.getState().start('r1');

    expect(ordem).toEqual(['start', 'clear', 'contexto']);
  });

  it('sair do suporte limpa o cache mesmo com falha no backend', async () => {
    qc.clear.mockReset();
    vi.mocked(endSupport).mockRejectedValueOnce(new Error('expirada'));

    await expect(useSupportStore.getState().end('r1')).rejects.toThrow('expirada');

    expect(qc.clear).toHaveBeenCalledTimes(1);
    expect(useSupportStore.getState().context).toBeNull();
  });
});
