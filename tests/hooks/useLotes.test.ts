import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

// Mock useAuth para devolver sempre um usuário válido (enabled=true).
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'diego@empresa' },
    session: { access_token: 't' },
    loading: false,
  }),
}));

// Mock supabase client com fluent API mínima usada pelo queries.ts.
const lotesData = [
  {
    id: 'lote-42',
    numero: 42,
    criado_em: '2026-05-25T14:32:00.000Z',
    status: 'revisao',
    total_familias: 50,
    total_publicadas: 0,
    total_erros: 0,
    user_id: 'u1',
    erro_mensagem: null,
    atualizado_em: '2026-05-25T14:32:00.000Z',
    imagens_paths: [],
    planilha_path: null,
  },
];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: lotesData, error: null }),
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: lotesData[0], error: null }),
        }),
      }),
    }),
  },
}));

import { useLotes, useLote } from '@/hooks/useLotes';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useLotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna lista de lotes via TanStack Query', async () => {
    const { result } = renderHook(() => useLotes(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeDefined();
    expect(result.current.data?.length).toBeGreaterThanOrEqual(1);
    expect(result.current.data?.[0]).toMatchObject({
      id: 'lote-42',
      numero: 42,
      status: 'revisao',
    });
  });
});

describe('useLote', () => {
  it('retorna o lote com o id fornecido', async () => {
    const { result } = renderHook(() => useLote('lote-42'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.numero).toBe(42);
  });

  it('fica disabled (idle) quando id é undefined', () => {
    const { result } = renderHook(() => useLote(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
