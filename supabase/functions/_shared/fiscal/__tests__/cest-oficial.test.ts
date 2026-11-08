import { describe, expect, it, vi } from 'vitest';
import { cestInexistente } from '../cest-oficial.ts';

// Fake admin: só from('cest_oficial').select().eq().limit().
function fakeAdmin(resp: { data?: unknown[] | null; error?: { message: string } | null }) {
  const from = vi.fn(() => {
    const api = {
      select: () => api,
      eq: () => api,
      limit: async () => ({ data: resp.data ?? null, error: resp.error ?? null }),
    };
    return api;
  });
  return { admin: { from } as never, from };
}

describe('cestInexistente (emenda D-7 do ADR-0197)', () => {
  it('CEST fora da tabela → mensagem', async () => {
    const { admin } = fakeAdmin({ data: [] });
    expect(await cestInexistente(admin, '3304999')).toMatch(/CEST 3304999 não existe na tabela oficial/);
  });

  it('CEST na tabela → null', async () => {
    const { admin } = fakeAdmin({ data: [{ cest: '2001500' }] });
    expect(await cestInexistente(admin, '2001500')).toBeNull();
  });

  it('vazio/null não consulta', async () => {
    const { admin, from } = fakeAdmin({ data: [] });
    expect(await cestInexistente(admin, null)).toBeNull();
    expect(await cestInexistente(admin, '  ')).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('erro de leitura rejeita (fail-closed)', async () => {
    const { admin } = fakeAdmin({ error: { message: 'boom' } });
    await expect(cestInexistente(admin, '2001500')).rejects.toThrow(/boom/);
  });
});
