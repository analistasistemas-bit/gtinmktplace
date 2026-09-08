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

/**
 * Stub do supabase-js para `resolverOrigemEstoque`: distingue `variacoes` (1ª e 3ª consulta)
 * de `familias` (2ª consulta), porque a resolução real de kit passa pelas três — o mock antigo,
 * de resposta única para qualquer tabela, é o que deixou o bug de codigo_pai passar (ADR-0151).
 */
function fakeAdmin(opts: {
  /** Resposta da 1ª consulta (`variacoes` + `familias!inner`) para o `codigo` pedido. */
  fam?: { codigo_pai: string; kit_base_codigo_pai: string | null; kit_multiplicador: number | null } | null;
  erroFam?: string;
  /** Resposta da 2ª consulta (`familias` por `codigo_pai` = base). */
  famBase?: { id: string } | null;
  /** Resposta da 3ª consulta (`variacoes` por `familia_id` da base). */
  varsBase?: Array<{ codigo: string }>;
  erroVarsBase?: string;
}) {
  let chamadasVariacoes = 0;

  const queryPorCodigo = () => ({
    select: () => queryPorCodigo(),
    eq: () => queryPorCodigo(),
    order: () => queryPorCodigo(),
    limit: () => queryPorCodigo(),
    maybeSingle: () => Promise.resolve(
      opts.erroFam
        ? { data: null, error: { message: opts.erroFam } }
        : { data: opts.fam ? { familias: opts.fam } : null, error: null },
    ),
  });

  const queryFamiliaBase = () => ({
    select: () => queryFamiliaBase(),
    eq: () => queryFamiliaBase(),
    order: () => queryFamiliaBase(),
    limit: () => queryFamiliaBase(),
    maybeSingle: () => Promise.resolve({ data: opts.famBase ?? null, error: null }),
  });

  const queryVariacoesDaBase = () => ({
    select: () => queryVariacoesDaBase(),
    eq: () => queryVariacoesDaBase(),
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve(
        opts.erroVarsBase
          ? { data: null, error: { message: opts.erroVarsBase } }
          : { data: opts.varsBase ?? [], error: null },
      ).then(res),
  });

  return {
    from: (tabela: string) => {
      if (tabela === 'variacoes') {
        chamadasVariacoes++;
        return chamadasVariacoes % 2 === 1 ? queryPorCodigo() : queryVariacoesDaBase();
      }
      return queryFamiliaBase();
    },
  } as never;
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
  it('SKU comum devolve ele mesmo, multiplicador 1, sem erro', async () => {
    const admin = fakeAdmin({ fam: { codigo_pai: 'PAI-01', kit_base_codigo_pai: null, kit_multiplicador: null } });
    expect(await resolverOrigemEstoque(admin, 'org-1', 'SKU-01'))
      .toEqual({ codigoCanonico: 'SKU-01', multiplicador: 1, kitCodigoPai: null });
  });

  it('SKU de kit devolve o codigo da VARIAÇÃO da base, nunca o codigo_pai (bug do ADR-0151)', async () => {
    const admin = fakeAdmin({
      fam: { codigo_pai: 'KIT-88', kit_base_codigo_pai: 'PAI-82', kit_multiplicador: 2 },
      famBase: { id: 'f-base' },
      varsBase: [{ codigo: 'VAR-83' }],
    });
    const r = await resolverOrigemEstoque(admin, 'org-1', 'KIT-89');
    expect(r).toEqual({ codigoCanonico: 'VAR-83', multiplicador: 2, kitCodigoPai: 'KIT-88' });
    expect(r.erro).toBeUndefined();
  });

  it('base com 2 variações não resolve — devolve erro, nunca baixa no SKU do kit', async () => {
    const admin = fakeAdmin({
      fam: { codigo_pai: 'KIT-88', kit_base_codigo_pai: 'PAI-82', kit_multiplicador: 2 },
      famBase: { id: 'f-base' },
      varsBase: [{ codigo: 'VAR-83' }, { codigo: 'VAR-84' }],
    });
    const r = await resolverOrigemEstoque(admin, 'org-1', 'KIT-89');
    expect(r.erro).toBeTruthy();
  });

  it('família base inexistente — devolve erro', async () => {
    const admin = fakeAdmin({
      fam: { codigo_pai: 'KIT-88', kit_base_codigo_pai: 'PAI-82', kit_multiplicador: 2 },
      famBase: null,
    });
    const r = await resolverOrigemEstoque(admin, 'org-1', 'KIT-89');
    expect(r.erro).toBeTruthy();
  });

  it('erro de leitura na 1ª consulta — devolve erro', async () => {
    const admin = fakeAdmin({ erroFam: 'conexão caiu' });
    const r = await resolverOrigemEstoque(admin, 'org-1', 'SKU-01');
    expect(r.erro).toBeTruthy();
  });

  it('SKU sem linha nenhuma em variacoes — neutro, sem erro (comportamento preservado)', async () => {
    const admin = fakeAdmin({ fam: null });
    expect(await resolverOrigemEstoque(admin, 'org-1', '00009999'))
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
