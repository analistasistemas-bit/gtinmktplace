import { describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { aguardarSyncFiscal } from '../aguardar-sync-fiscal';

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));

// 1ª chamada: família (maybeSingle). Demais: versões publicadas (then), uma resposta por volta.
function mockFamilias(voltas: Array<Array<{ fiscal_sincronizado_em: string | null }>>) {
  let volta = 0;
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const api: Record<string, unknown> = {
      select: () => api,
      eq: () => api,
      maybeSingle: async () => ({ data: { org_id: 'org-1', codigo_pai: '00000208' }, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: voltas[Math.min(volta++, voltas.length - 1)], error: null }).then(resolve),
    };
    return api;
  });
}

describe('aguardarSyncFiscal', () => {
  it('resolve true quando todas as versões publicadas sincronizam', async () => {
    mockFamilias([[{ fiscal_sincronizado_em: null }], [{ fiscal_sincronizado_em: '2026-11-07T21:13:17Z' }]]);
    expect(await aguardarSyncFiscal('fam-1', { intervaloMs: 1, limiteMs: 1000 })).toBe(true);
  });

  it('resolve false no teto quando o worker não conclui', async () => {
    mockFamilias([[{ fiscal_sincronizado_em: null }]]);
    expect(await aguardarSyncFiscal('fam-1', { intervaloMs: 1, limiteMs: 20 })).toBe(false);
  });

  it('sem versão publicada não espera', async () => {
    mockFamilias([[]]);
    expect(await aguardarSyncFiscal('fam-1', { intervaloMs: 1, limiteMs: 1000 })).toBe(false);
  });
});
