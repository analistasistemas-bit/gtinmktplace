import { describe, it, expect, vi } from 'vitest';
import { publicarFamilias } from '@/lib/publicar';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'token-teste' } } }),
    },
  },
}));

describe('publicarFamilias', () => {
  it('inclui a escolha de somente estoque no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enfileiradas: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await publicarFamilias(['F1'], 'gold_special', ['mercado_livre'], {
      somenteEstoqueGlobal: true,
      somenteEstoqueOverrides: ['F1'],
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.somente_estoque_global).toBe(true);
    expect(body.somente_estoque_overrides).toEqual(['F1']);

    vi.unstubAllGlobals();
  });
});
