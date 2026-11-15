import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const remove = vi.fn().mockResolvedValue({ error: null });
let linhasAfetadas: { id: string }[] = [];
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { logo_escuro_url: 'https://p.supabase.co/storage/v1/object/public/org-logos/org-1/escuro-1.png' }, error: null }) }) }),
      update: () => ({ eq: () => ({ select: async () => ({ data: linhasAfetadas, error: null }) }) }),
    }),
    storage: { from: () => ({ remove }) },
  },
}));
vi.mock('@/hooks/useOrgEfetivaId', () => ({ useOrgEfetivaId: () => 'org-1' }));

import { useSalvarLogoOrg } from '../useSalvarLogoOrg';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

describe('useSalvarLogoOrg — remover', () => {
  it('RLS barrou (0 linhas): erro, e o arquivo antigo não é apagado', async () => {
    linhasAfetadas = [];
    const { result } = renderHook(() => useSalvarLogoOrg(), { wrapper });
    result.current.mutate({ variante: 'escuro', arquivo: null });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(remove).not.toHaveBeenCalled();
  });

  it('gravou: apaga o arquivo antigo pelo caminho dentro do bucket', async () => {
    linhasAfetadas = [{ id: 'org-1' }];
    const { result } = renderHook(() => useSalvarLogoOrg(), { wrapper });
    result.current.mutate({ variante: 'escuro', arquivo: null });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(remove).toHaveBeenCalledWith(['org-1/escuro-1.png']);
  });
});
