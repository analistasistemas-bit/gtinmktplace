// fetchKitsVinculadosDaOrg precisa paginar: o PostgREST corta em 1000 linhas sem avisar.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const range = vi.fn();
const linha = (n: number) => ({
  id: `f${n}`, codigo_pai: `K${n}`, kit_base_codigo_pai: 'B', kit_multiplicador: 2,
  status: 'pronto', ml_permalink: null, ml_item_id: null, criado_em: '2026-01-01',
});
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        not: () => ({ order: () => ({ range: (de: number, ate: number) => range(de, ate) }) }),
      }),
    }),
  },
}));

import { fetchKitsVinculadosDaOrg } from '@/lib/queries';

beforeEach(() => range.mockReset());

describe('fetchKitsVinculadosDaOrg', () => {
  it('lê todas as páginas (1000 + resto), não só a primeira', async () => {
    range
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => linha(i)), error: null })
      .mockResolvedValueOnce({ data: [linha(1000), linha(1001)], error: null });
    const kits = await fetchKitsVinculadosDaOrg();
    expect(kits).toHaveLength(1002);
    expect(range).toHaveBeenCalledTimes(2);
    expect(range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });
});
