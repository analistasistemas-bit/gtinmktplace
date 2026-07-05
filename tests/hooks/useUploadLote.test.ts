import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUploadLote } from '@/hooks/useUploadLote';

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

describe('useUploadLote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts with idle status and 0% progress', () => {
    const { result } = renderHook(() => useUploadLote());
    expect(result.current.status).toBe('idle');
    expect(result.current.progresso).toBe(0);
  });

  it('upload pipeline: cria lote, sobe planilha + imagens, chama ingest', async () => {
    const { result } = renderHook(() => useUploadLote());
    const planilha = new File(['x'], 'lote.xlsx');
    const imagens = [new File(['a'], '00000001.jpeg'), new File(['b'], '00000002.jpeg')];

    await act(async () => {
      await result.current.iniciar(planilha, imagens);
    });

    expect(result.current.status).toBe('concluido');
    expect(result.current.progresso).toBe(100);
    expect(result.current.loteId).toBe('l1');
  });
});
