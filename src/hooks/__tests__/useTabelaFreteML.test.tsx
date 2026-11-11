import { createElement, type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const m = vi.hoisted(() => ({ fetchTabelaFrete: vi.fn(), org: 'org-a' as string | null }));
vi.mock('@/hooks/useOrgEfetivaId', () => ({ useOrgEfetivaId: () => m.org }));
vi.mock('@/lib/tabela-frete', async (orig) => ({
  ...(await orig<typeof import('@/lib/tabela-frete')>()),
  fetchTabelaFrete: m.fetchTabelaFrete,
}));

const { useTabelaFreteML } = await import('../useTabelaFreteML');

const completa = { faixasPreco: [], faixasPeso: [], celulas: [[0, 1]] };
const incompleta = { faixasPreco: [], faixasPeso: [], celulas: [[null, 1]] };

let qc: QueryClient;
function render() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useTabelaFreteML('MLB1', true), { wrapper });
}
const staleTimeDe = () => {
  const q = qc.getQueryCache().find({ queryKey: ['tabela-frete', 'org-a', 'MLB1'] })!;
  const st = q.observers[0].options.staleTime;
  const ms = typeof st === 'function' ? st(q) : (st ?? 0);
  return Number(ms) <= 5 * 60 * 1000 ? 'curto' : 'longo';
};

describe('useTabelaFreteML', () => {
  beforeEach(() => { m.fetchTabelaFrete.mockReset(); });

  it('chave inclui a org', async () => {
    m.fetchTabelaFrete.mockResolvedValue(completa);
    render();
    await waitFor(() => expect(qc.getQueryCache().find({ queryKey: ['tabela-frete', 'org-a', 'MLB1'] })).toBeDefined());
  });

  it('completa → cache 24 h', async () => {
    m.fetchTabelaFrete.mockResolvedValue(completa);
    const { result } = render();
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(staleTimeDe()).toBe('longo');
  });

  it('incompleta → refaz após 5 min', async () => {
    m.fetchTabelaFrete.mockResolvedValue(incompleta);
    const { result } = render();
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(staleTimeDe()).toBe('curto');
  });

  it('erro → refaz após 5 min', async () => {
    m.fetchTabelaFrete.mockResolvedValue({ erro: true });
    const { result } = render();
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(staleTimeDe()).toBe('curto');
  });
});
