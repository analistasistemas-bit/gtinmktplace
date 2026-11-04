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

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
const ok = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() }) as never;

describe('useSugestoesPromocao', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

  it('sync novo relê convites e sinais, mesmo com as mesmas campanhas', async () => {
    const promocao = (marca: string) => ({ promocao_id: 'C1', tipo: 'DEAL', status: 'started', fim: null, itens_sincronizados_em: marca });
    vi.mocked(usePromocoes).mockReturnValue(ok([promocao('2026-11-03T10:00:00Z')]));
    const { result, rerender } = renderHook(() => useSugestoesPromocao(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const convites = vi.mocked(fetchConvites).mock.calls.length;
    const sinais = vi.mocked(buscarTodasPaginas).mock.calls.length;
    vi.mocked(usePromocoes).mockReturnValue(ok([promocao('2026-11-04T10:00:00Z')]));
    rerender();
    await waitFor(() => expect(vi.mocked(fetchConvites).mock.calls.length).toBe(convites + 1));
    await waitFor(() => expect(vi.mocked(buscarTodasPaginas).mock.calls.length).toBeGreaterThan(sinais));
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
