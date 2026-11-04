import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSugestoesPromocao } from '../useSugestoesPromocao';
import { useParticipacoes, usePromocoes } from '@/hooks/usePromocoes';
import { buscarTodasPaginas } from '@/lib/paginacao-supabase';
import { fetchConvites } from '@/lib/promocoes';

vi.mock('@/hooks/usePromocoes', () => ({ usePromocoes: vi.fn(), useParticipacoes: vi.fn() }));
vi.mock('@/lib/paginacao-supabase', () => ({ buscarTodasPaginas: vi.fn() }));
vi.mock('@/lib/promocoes', async () => ({ ...(await vi.importActual<typeof import('@/lib/promocoes')>('@/lib/promocoes')), fetchConvites: vi.fn() }));
const from = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { from: (t: string) => from(t), rpc: vi.fn(), functions: { invoke: vi.fn() } } }));

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() }) as never;

describe('useSugestoesPromocao', () => {
  beforeEach(() => {
    vi.mocked(usePromocoes).mockReturnValue(ok([]));
    vi.mocked(useParticipacoes).mockReturnValue(ok([]));
    vi.mocked(fetchConvites).mockResolvedValue([]);
    vi.mocked(buscarTodasPaginas).mockResolvedValue([]);
    from.mockReturnValue({ select: () => Promise.resolve({ data: [], error: null }) });
  });

  it('com todas as fontes entrega o resultado', async () => {
    const { result } = renderHook(() => useSugestoesPromocao(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.isError).toBe(false);
  });

  it('falha nos sinais não vira lista vazia', async () => {
    vi.mocked(buscarTodasPaginas).mockRejectedValue(new Error('rpc'));
    const { result } = renderHook(() => useSugestoesPromocao(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it('falha nas participações não vira lista vazia', async () => {
    vi.mocked(useParticipacoes).mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() } as never);
    const { result } = renderHook(() => useSugestoesPromocao(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
