import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke } },
}));

import { platformAdminKeys } from '@/hooks/usePlatformAdmin';
import { callPlatformAdmin } from '@/lib/platform-admin';

describe('callPlatformAdmin', () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it('invoca a action com os parâmetros e devolve o DTO', async () => {
    const response = { totals: { gross_cents: 123_00 } };
    invoke.mockResolvedValue({ data: response, error: null });

    await expect(callPlatformAdmin('wallet', { month: '2026-08' })).resolves.toBe(response);
    expect(invoke).toHaveBeenCalledWith('platform-admin', {
      body: { action: 'wallet', month: '2026-08' },
    });
  });

  it('preserva mensagem e code do corpo em resposta HTTP não-2xx', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: 'Edge Function returned a non-2xx status code',
        context: {
          json: vi.fn().mockResolvedValue({
            error: 'Organização não encontrada',
            code: 'organization_not_found',
          }),
        },
      },
    });

    const error = await callPlatformAdmin('wallet', {
      month: '2026-08',
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: 'Organização não encontrada',
      code: 'organization_not_found',
    });
  });

  it('trata data.error como falha sem converter em sucesso vazio', async () => {
    invoke.mockResolvedValue({
      data: { error: 'Acesso negado', code: 'forbidden' },
      error: null,
    });

    await expect(callPlatformAdmin('wallet', { month: '2026-08' })).rejects.toMatchObject({
      message: 'Acesso negado',
      code: 'forbidden',
    });
  });
});

describe('platformAdminKeys', () => {
  it('isola o cache por usuário, action, organização e período', () => {
    const august = platformAdminKeys.metrics('user-1', 'org-1', '2026-08');
    const september = platformAdminKeys.metrics('user-1', 'org-1', '2026-09');
    const otherOrg = platformAdminKeys.metrics('user-1', 'org-2', '2026-08');

    expect(august).toEqual([
      'platform-admin',
      'user-1',
      'metrics',
      'org-1',
      '2026-08',
      {},
    ]);
    expect(new Set([JSON.stringify(august), JSON.stringify(september), JSON.stringify(otherOrg)]).size).toBe(3);
  });

  it('monta a key da carteira com os filtros e isola por termo de busca', () => {
    const base = platformAdminKeys.wallet('user-1', { month: '2026-08', include_test: false, page: 1, page_size: 10, sort: 'name' });
    const searched = platformAdminKeys.wallet('user-1', { month: '2026-08', search: 'avil', include_test: false, page: 1, page_size: 10, sort: 'name' });

    expect(base).toEqual([
      'platform-admin',
      'user-1',
      'wallet',
      null,
      '2026-08',
      { include_test: false, page: 1, page_size: 10, sort: 'name' },
    ]);
    expect(JSON.stringify(base)).not.toBe(JSON.stringify(searched));
  });
});
