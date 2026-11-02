import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useMonthlyReport } from '../usePlatformAdmin';
import { useAuthStore } from '@/stores/auth-store';

const call = vi.fn();
vi.mock('@/lib/platform-admin', () => ({ callPlatformAdmin: (...a: unknown[]) => call(...a) }));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => { cleanup(); call.mockReset(); useAuthStore.setState({ user: null }); });

describe('useMonthlyReport', () => {
  it('chama a ação monthly_report com org e mês', async () => {
    useAuthStore.setState({ user: { id: 'u1' } as never });
    call.mockResolvedValue({ month: '2026-10' });
    const { result } = renderHook(() => useMonthlyReport('org-a', '2026-10'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual({ month: '2026-10' }));
    expect(call).toHaveBeenCalledWith('monthly_report', { org_id: 'org-a', month: '2026-10' });
  });

  it('sem usuário ou sem org a query fica desabilitada', () => {
    renderHook(() => useMonthlyReport('org-a', '2026-10'), { wrapper: wrapper() });
    expect(call).not.toHaveBeenCalled();
    cleanup();
    useAuthStore.setState({ user: { id: 'u1' } as never });
    renderHook(() => useMonthlyReport('', '2026-10'), { wrapper: wrapper() });
    expect(call).not.toHaveBeenCalled();
  });
});
