import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useMarcaOrg } from '../useMarcaOrg';
import { useSupportStore } from '@/stores/support-store';
import { useAuthStore } from '@/stores/auth-store';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup(); rpc.mockReset();
  useSupportStore.setState({ context: null });
  useAuthStore.setState({ profile: null });
});

describe('useMarcaOrg', () => {
  it('trocar a org efetiva (suporte) busca de novo, sem reaproveitar a org anterior', async () => {
    useAuthStore.setState({ profile: { org_id: 'org-a' } as never });
    rpc.mockResolvedValueOnce({ data: { marca_propria: true, marca_padrao: 'Zaven' }, error: null });
    rpc.mockResolvedValueOnce({ data: { marca_propria: true, marca_padrao: 'Lacoste' }, error: null });
    const { result } = renderHook(() => useMarcaOrg(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.marca_padrao).toBe('Zaven'));
    act(() => { useSupportStore.setState({ context: { orgId: 'org-b' } as never }); });
    await waitFor(() => expect(result.current.data?.marca_padrao).toBe('Lacoste'));
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('sem org efetiva a query fica desabilitada', () => {
    renderHook(() => useMarcaOrg(), { wrapper: wrapper() });
    expect(rpc).not.toHaveBeenCalled();
  });
});
