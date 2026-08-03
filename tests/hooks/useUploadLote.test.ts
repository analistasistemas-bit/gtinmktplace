import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useUploadLote } from '@/hooks/useUploadLote';
import { QK } from '@/lib/queries';

vi.mock('@/lib/storage', () => ({
  uploadFile: vi.fn(async () => 'u1/l1/file'),
  buildStoragePath: (u: string, l: string, n: string) => `${u}/${l}/${n}`,
}));

vi.mock('@/lib/ingest', () => ({
  chamarIngest: vi.fn(async () => ({ loteId: 'l1', totalFamilias: 3 })),
}));

// E7: o insert do lote carimba org_id do perfil (auth-store).
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: { getState: () => ({ profile: { org_id: 'org1' } }) },
}));

vi.mock('@/lib/supabase', () => {
  const single = vi.fn().mockResolvedValue({
    data: { id: 'l1', user_id: 'u1' },
    error: null,
  });
  return {
    supabase: {
      from: vi.fn(() => ({
        insert: vi.fn(() => ({ select: vi.fn(() => ({ single })) })),
        update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
      })),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    },
  };
});

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe('useUploadLote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts with idle status and 0% progress', () => {
    const { result } = renderHook(() => useUploadLote(), { wrapper });
    expect(result.current.status).toBe('idle');
    expect(result.current.progresso).toBe(0);
  });

  it('upload pipeline: cria lote, sobe planilha + imagens, chama ingest', async () => {
    const { result } = renderHook(() => useUploadLote(), { wrapper });
    const planilha = new File(['x'], 'lote.xlsx');
    const imagens = [new File(['a'], '00000001.jpeg'), new File(['b'], '00000002.jpeg')];

    await act(async () => {
      await result.current.iniciar(planilha, imagens);
    });

    expect(result.current.status).toBe('concluido');
    expect(result.current.progresso).toBe(100);
    expect(result.current.loteId).toBe('l1');
  });

  // Achado 03/08: lote #44 (falha no ingest) sumia da tela "Histórico de lotes" porque nada
  // invalidava QK.lotes — o insert é feito direto pelo cliente, fora do react-query.
  it('invalida QK.lotes ao criar o lote, para a lista aparecer sem precisar de F5', async () => {
    // qc criado FORA do componente wrapper (não a cada render) — senão o spy prenderia
    // numa instância que `iniciar` já não usaria depois de um re-render (setStatus/setProgresso
    // disparam vários durante o upload).
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function wrapperComQc({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: qc }, children);
    }
    const { result } = renderHook(() => useUploadLote(), { wrapper: wrapperComQc });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    await act(async () => {
      await result.current.iniciar(new File(['x'], 'lote.xlsx'), []);
    });

    // Os 3 pontos de invalidação do hook (insert, sucesso, erro) — este teste cobre o
    // caminho de sucesso; todos chamam com a mesma chave.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: QK.lotes('u1') });
    expect(invalidateSpy).toHaveBeenCalledTimes(2); // insert + sucesso (não passa pelo catch)
  });
});
