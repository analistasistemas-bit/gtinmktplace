import { describe, it, expect } from 'vitest';
import { resolverOrigemEstoque, saldoDoKit } from '../kit.ts';

/** Stub mínimo do supabase-js: só o encadeamento que `resolverOrigemEstoque` usa. */
function fakeAdmin(fam: { codigo_pai: string; kit_base_codigo_pai: string | null; kit_multiplicador: number | null } | null) {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve({ data: fam ? { familias: fam } : null, error: null }),
  };
  return { from: () => q } as never;
}

describe('saldoDoKit', () => {
  it('arredonda para baixo', () => {
    expect(saldoDoKit(7, 2)).toBe(3);
    expect(saldoDoKit(1, 2)).toBe(0);
    expect(saldoDoKit(0, 6)).toBe(0);
    expect(saldoDoKit(12, 6)).toBe(2);
  });

  it('nunca devolve negativo', () => {
    expect(saldoDoKit(-5, 2)).toBe(0);
  });
});

describe('resolverOrigemEstoque', () => {
  it('SKU comum devolve ele mesmo, multiplicador 1', async () => {
    const admin = fakeAdmin({ codigo_pai: '00000010', kit_base_codigo_pai: null, kit_multiplicador: null });
    expect(await resolverOrigemEstoque(admin, 'org-1', '00000011'))
      .toEqual({ codigoCanonico: '00000011', multiplicador: 1, kitCodigoPai: null });
  });

  it('SKU de kit devolve o codigo_pai da base e o multiplicador', async () => {
    const admin = fakeAdmin({ codigo_pai: '00000020', kit_base_codigo_pai: '00000010', kit_multiplicador: 3 });
    expect(await resolverOrigemEstoque(admin, 'org-1', '00000021'))
      .toEqual({ codigoCanonico: '00000010', multiplicador: 3, kitCodigoPai: '00000020' });
  });

  it('SKU inexistente degrada para o próprio código', async () => {
    expect(await resolverOrigemEstoque(fakeAdmin(null), 'org-1', '00009999'))
      .toEqual({ codigoCanonico: '00009999', multiplicador: 1, kitCodigoPai: null });
  });
});
