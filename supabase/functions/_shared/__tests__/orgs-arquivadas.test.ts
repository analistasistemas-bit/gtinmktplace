import { describe, expect, it } from 'vitest';
import { filtroNotIn, listarOrgsArquivadas } from '../orgs-arquivadas.ts';

function fakeAdmin(total: number, error?: string) {
  const ids = Array.from({ length: total }, (_, n) => ({ id: `org-${n}` }));
  const q: any = {
    select: () => q, not: () => q, order: () => q,
    range: async (de: number, ate: number) => error
      ? { data: null, error: { message: error } }
      : { data: ids.slice(de, ate + 1), error: null },
  };
  return { from: () => q } as never;
}

describe('orgs-arquivadas', () => {
  it('pagina além de 1000 linhas', async () => {
    expect((await listarOrgsArquivadas(fakeAdmin(1001))).size).toBe(1001);
  });
  it('erro lança', async () => {
    await expect(listarOrgsArquivadas(fakeAdmin(1, 'boom'))).rejects.toThrow(/boom/);
  });
  it('filtroNotIn', () => {
    expect(filtroNotIn(new Set())).toBeNull();
    expect(filtroNotIn(new Set(['a', 'b']))).toBe('(a,b)');
  });
});
