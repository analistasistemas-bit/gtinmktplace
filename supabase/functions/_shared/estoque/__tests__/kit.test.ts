import { describe, it, expect } from 'vitest';
import { aplicarEstoqueDerivado, resolverOrigemEstoque, saldoDoKit } from '../kit.ts';

/** Stub mínimo do supabase-js: só o encadeamento que `aplicarEstoqueDerivado` usa. */
function adminComSaldoDaBase(estoqueBase: number) {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve({ data: { id: 'f-base' }, error: null }),
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [{ codigo: '00000011', estoque: estoqueBase }], error: null }).then(res),
  };
  // deno-lint-ignore no-explicit-any
  return { from: () => q } as any;
}

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

describe('aplicarEstoqueDerivado', () => {
  it('família comum passa direto', async () => {
    const vars = [{ codigo: '00000011', estoque: 7 }];
    const r = await aplicarEstoqueDerivado(
      adminComSaldoDaBase(7), 'org-1',
      { kit_base_codigo_pai: null, kit_multiplicador: null }, vars,
    );
    expect(r).toEqual([{ codigo: '00000011', estoque: 7 }]);
  });

  it('kit publica floor(base/N), não a coluna crua', async () => {
    const vars = [{ codigo: '00000021', estoque: 0 }];
    const r = await aplicarEstoqueDerivado(
      adminComSaldoDaBase(7), 'org-1',
      { kit_base_codigo_pai: '00000010', kit_multiplicador: 3 }, vars,
    );
    expect(r).toEqual([{ codigo: '00000021', estoque: 2 }]);
  });

  it('base zerada publica kit com 0', async () => {
    const vars = [{ codigo: '00000021', estoque: 0 }];
    const r = await aplicarEstoqueDerivado(
      adminComSaldoDaBase(0), 'org-1',
      { kit_base_codigo_pai: '00000010', kit_multiplicador: 2 }, vars,
    );
    expect(r).toEqual([{ codigo: '00000021', estoque: 0 }]);
  });
});
