import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useFamilia } from '../useFamilia';

const q = vi.hoisted(() => ({
  fetchFamiliaPublicada: vi.fn(async () => ({ variacoes: [{ custo: 10 }] })),
  fetchFamiliaComCustoRecente: vi.fn(async () => ({ variacoes: [{ custo: 20 }] })),
}));
vi.mock('@/lib/queries', async (orig) => ({ ...(await orig<typeof import('@/lib/queries')>()), ...q }));

describe('useFamilia', () => {
  it('Criar kit lê o custo da família (a edge grava esse); o painel lê o recente, sem dividir o cache', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const kit = renderHook(() => useFamilia('F1', true), { wrapper });
    const painel = renderHook(() => useFamilia('F1', true, true), { wrapper });
    await waitFor(() => expect(kit.result.current.data?.variacoes[0].custo).toBe(10));
    await waitFor(() => expect(painel.result.current.data?.variacoes[0].custo).toBe(20));
  });
});
