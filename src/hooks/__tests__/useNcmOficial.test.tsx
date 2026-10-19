import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNcmOficial } from '../useNcmOficial';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, W: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> };
}

afterEach(() => vi.clearAllMocks());

describe('useNcmOficial (ADR-0187)', () => {
  it('menos de 8 dígitos: incompleto, sem chamar o banco', () => {
    const { W } = wrapper();
    const { result } = renderHook(() => useNcmOficial('6203'), { wrapper: W });
    expect(result.current).toEqual({ status: 'incompleto', descricao: null });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('código existente e vigente: ok + descrição', async () => {
    rpc.mockResolvedValue({ data: [{ codigo: '62034900', descricao: 'Calças', vigente: true }], error: null });
    const { W } = wrapper();
    const { result } = renderHook(() => useNcmOficial('62034900'), { wrapper: W });
    expect(result.current.status).toBe('carregando');
    await waitFor(() => expect(result.current).toEqual({ status: 'ok', descricao: 'Calças' }));
    expect(rpc).toHaveBeenCalledWith('ncm_consultar', { p_codigos: ['62034900'] });
  });

  it('rpc vazio: inexistente; vigente=false: vencido', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const a = renderHook(() => useNcmOficial('75937727'), { wrapper: wrapper().W });
    await waitFor(() => expect(a.result.current.status).toBe('inexistente'));
    rpc.mockResolvedValue({ data: [{ codigo: '11111111', descricao: 'Velho', vigente: false }], error: null });
    const b = renderHook(() => useNcmOficial('11111111'), { wrapper: wrapper().W });
    await waitFor(() => expect(b.result.current.status).toBe('vencido'));
  });

  it('rpc com erro: status erro (fail-closed)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useNcmOficial('62034900'), { wrapper: wrapper().W });
    await waitFor(() => expect(result.current.status).toBe('erro'));
  });

  it('sucesso seguido de refetch com erro: o erro prevalece sobre o dado antigo', async () => {
    rpc.mockResolvedValueOnce({ data: [{ codigo: '62034900', descricao: 'Calças', vigente: true }], error: null });
    const { qc, W } = wrapper();
    const { result } = renderHook(() => useNcmOficial('62034900'), { wrapper: W });
    await waitFor(() => expect(result.current.status).toBe('ok'));
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await qc.refetchQueries({ queryKey: ['ncm-oficial', '62034900'] });
    await waitFor(() => expect(result.current.status).toBe('erro'));
  });

  it('refetch em andamento com cache válido: carregando; depois reflete o novo resultado', async () => {
    rpc.mockResolvedValueOnce({ data: [{ codigo: '62034900', descricao: 'Calças', vigente: true }], error: null });
    const { qc, W } = wrapper();
    const { result } = renderHook(() => useNcmOficial('62034900'), { wrapper: W });
    await waitFor(() => expect(result.current.status).toBe('ok'));
    let liberar!: (v: unknown) => void;
    rpc.mockReturnValueOnce(new Promise((r) => { liberar = r; }));
    void qc.refetchQueries({ queryKey: ['ncm-oficial', '62034900'] });
    await waitFor(() => expect(result.current.status).toBe('carregando'));
    liberar({ data: [{ codigo: '62034900', descricao: 'Calças', vigente: false }], error: null });
    await waitFor(() => expect(result.current.status).toBe('vencido'));
  });
});
