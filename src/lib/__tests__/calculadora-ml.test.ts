import { describe, expect, it } from 'vitest'

import {
  calcularPesoUtilizado,
  calcularSimulacaoML,
  type CotacoesPorModalidade,
  type EntradaCalculadoraML,
} from '../calculadora-ml'

describe('calcularPesoUtilizado', () => {
  it('uses the greater of real and cubic weight without rounding its calculation', () => {
    const resultado = calcularPesoUtilizado({
      alturaCm: 25,
      larguraCm: 20,
      comprimentoCm: 30,
      pesoKg: 2,
    })

    expect(resultado).toEqual({
      pesoCubadoKg: 2.5,
      pesoUtilizadoKg: 2.5,
    })
  })

  it('does not fabricate a shipping weight when dimensions are absent', () => {
    expect(calcularPesoUtilizado()).toBeNull()
  })
})

const entradaBase: EntradaCalculadoraML = {
  precoVenda: 100,
  custoProduto: 50,
  aliquotaImpostoPct: 10,
  custosFixos: 5,
  custosVariaveis: 3,
  rebate: 2,
  margemAlvoPct: 5,
}

const cotacoesBase: CotacoesPorModalidade = {
  classico: {
    percentualComissaoPct: 11.5,
    taxaFixa: 0,
    comissaoTotal: 11.5,
    frete: 16.15,
    proveniencia: 'official',
  },
  premium: {
    percentualComissaoPct: 16.5,
    taxaFixa: 0,
    comissaoTotal: 16.5,
    frete: 16.15,
    proveniencia: 'official',
  },
}

describe('calcularSimulacaoML', () => {
  it('compares Classic and Premium costs without treating rebate as a cost', () => {
    const resultado = calcularSimulacaoML(entradaBase, cotacoesBase)

    expect(resultado.modalidades.classico).toMatchObject({
      custos: {
        custoProduto: 50,
        comissao: 11.5,
        frete: 16.15,
        imposto: 10,
        custosFixos: 5,
        custosVariaveis: 3,
        rebate: 2,
        total: 93.65,
      },
      lucro: 6.35,
      margemPct: 6.35,
    })
    expect(resultado.modalidades.premium).toMatchObject({
      custos: { comissao: 16.5, total: 98.65 },
      lucro: 1.35,
      margemPct: 1.35,
    })
  })

  it('keeps unavailable freight distinct from zero', () => {
    const resultado = calcularSimulacaoML(entradaBase, {
      ...cotacoesBase,
      classico: { ...cotacoesBase.classico, frete: null, proveniencia: 'partial' },
    })

    expect(resultado.modalidades.classico).toBeNull()
    expect(resultado.veredito.tipo).toBe('Dados insuficientes')
  })

  it('derives manual Premium commission five points above Classic', () => {
    const cotacaoManualSemPremium: CotacoesPorModalidade = {
      origem: 'manual',
      classico: {
        percentualComissaoPct: 11.5,
        taxaFixa: 0,
        comissaoTotal: 11.5,
        frete: 16.15,
        proveniencia: 'estimated',
      },
    }

    const resultado = calcularSimulacaoML(entradaBase, cotacaoManualSemPremium)

    expect(resultado.modalidades.premium?.custos.comissao).toBe(16.5)
  })

  it('keeps manual fallback estimated even when a category is present', () => {
    const cotacaoManual: CotacoesPorModalidade = {
      origem: 'manual',
      classico: {
        percentualComissaoPct: 11.5,
        taxaFixa: 0,
        comissaoTotal: 11.5,
        frete: 16.15,
        proveniencia: 'estimated',
      },
    }

    const resultado = calcularSimulacaoML(
      { ...entradaBase, categoriaId: 'MLB123' },
      cotacaoManual,
    )

    expect(resultado.modalidades.classico?.proveniencia).toBe('estimated')
    expect(resultado.modalidades.premium?.proveniencia).toBe('estimated')
    expect(resultado.proveniencia).toBe('estimated')
  })

  it('downgrades results to estimated when no category was provided', () => {
    const resultado = calcularSimulacaoML(entradaBase, cotacoesBase)

    expect(resultado.modalidades.classico?.proveniencia).toBe('estimated')
    expect((resultado as { proveniencia?: string }).proveniencia).toBe('estimated')
  })

  it('calculates max purchase cost and marks current-quote target price as a projection', () => {
    const resultado = calcularSimulacaoML(
      { ...entradaBase, margemAlvoPct: 12 },
      cotacoesBase,
    )
    const classico = resultado.modalidades.classico

    expect(classico?.custoMaximoCompra).toBeCloseTo(44.35)
    expect(classico?.precoAlvo).toMatchObject({
      valor: 108.49624060150376,
      proveniencia: 'estimated',
      ehProjecao: true,
    })
  })

  it('recommends buying when the current margin reaches the goal', () => {
    const resultado = calcularSimulacaoML(entradaBase, cotacoesBase)

    expect(resultado.veredito.tipo).toBe('Comprar')
  })

  it('prioritizes negotiating cost when both cost and price could reach the goal', () => {
    const resultado = calcularSimulacaoML(
      { ...entradaBase, margemAlvoPct: 12 },
      cotacoesBase,
    )

    expect(resultado.veredito.tipo).toBe('Negociar custo')
    expect(resultado.veredito.fatores.join(' ')).toContain('44,35')
  })

  it('recommends adjusting price when reducing cost would require a negative value', () => {
    const resultado = calcularSimulacaoML(
      { ...entradaBase, margemAlvoPct: 60 },
      cotacoesBase,
    )

    expect(resultado.veredito.tipo).toBe('Ajustar preço')
  })

  it('avoids an unprofitable target whose projected price is mathematically impossible', () => {
    const resultado = calcularSimulacaoML(
      { ...entradaBase, margemAlvoPct: 90, modalidadeParaDecisao: 'premium' },
      cotacoesBase,
    )

    expect(resultado.veredito.tipo).toBe('Evitar')
  })

  it('reports insufficient data for a zero selling price and rejects malformed numbers', () => {
    expect(calcularSimulacaoML({ ...entradaBase, precoVenda: 0 }, cotacoesBase).veredito.tipo).toBe(
      'Dados insuficientes',
    )
    expect(() =>
      calcularSimulacaoML({ ...entradaBase, precoVenda: Number.NaN }, cotacoesBase),
    ).toThrow(RangeError)
  })

  it('rejects invalid quotation values even when freight is unavailable', () => {
    expect(() =>
      calcularSimulacaoML(entradaBase, {
        ...cotacoesBase,
        classico: {
          ...cotacoesBase.classico,
          comissaoTotal: Number.NaN,
          frete: null,
          proveniencia: 'partial',
        },
      }),
    ).toThrow(RangeError)
  })

  it('limits every decision explanation to three actionable factors', () => {
    const resultado = calcularSimulacaoML(
      { ...entradaBase, margemAlvoPct: 12 },
      cotacoesBase,
    )

    expect(resultado.veredito.fatores).toHaveLength(3)
  })

  it('keeps manual quotes with an unconfirmed commission from becoming actionable', () => {
    const resultado = calcularSimulacaoML(entradaBase, {
      origem: 'manual',
      classico: {
        percentualComissaoPct: 0,
        taxaFixa: 0,
        comissaoTotal: 0,
        frete: 16.15,
        proveniencia: 'estimated',
      },
    })

    expect(resultado.veredito.tipo).toBe('Dados insuficientes')
  })

  it('keeps a manual quote with unconfirmed freight from becoming actionable', () => {
    const resultado = calcularSimulacaoML(entradaBase, {
      origem: 'manual',
      classico: {
        percentualComissaoPct: 11.5,
        taxaFixa: 0,
        comissaoTotal: 11.5,
        frete: null,
        proveniencia: 'estimated',
      },
    })

    expect(resultado.veredito.tipo).toBe('Dados insuficientes')
  })

  it('rejects a manual Classic commission above 95% because Premium would exceed 100%', () => {
    expect(() =>
      calcularSimulacaoML(entradaBase, {
        origem: 'manual',
        classico: {
          percentualComissaoPct: 96,
          taxaFixa: 0,
          comissaoTotal: 96,
          frete: 16.15,
          proveniencia: 'estimated',
        },
      }),
    ).toThrow(/95/)
  })

  it('reports numeric profit changes for cost, price and freight sensitivity scenarios', () => {
    const resultado = calcularSimulacaoML(
      { ...entradaBase, categoriaId: 'MLB123' },
      cotacoesBase,
    )

    expect(resultado.modalidades.classico?.sensibilidade).toEqual({
      custoCompraMais10Pct: { lucro: 1.35, variacaoLucro: -5 },
      precoVendaMenos5Pct: { lucro: 2.42, variacaoLucro: -3.93 },
      freteMais5: { lucro: 1.35, variacaoLucro: -5 },
    })
    expect(resultado.modalidades.premium?.sensibilidade.precoVendaMenos5Pct).toEqual({
      lucro: -2.33,
      variacaoLucro: -3.68,
    })
  })
})

describe('calcularSimulacaoML — margem exata e imposto desconhecido', () => {
  it('não presume imposto: alíquota null → modalidade null e dados insuficientes', () => {
    const resultado = calcularSimulacaoML({ ...entradaBase, aliquotaImpostoPct: null }, cotacoesBase)

    expect(resultado.modalidades.classico).toBeNull()
    expect(resultado.veredito.tipo).toBe('Dados insuficientes')
    expect(resultado.veredito.fatores.join(' ')).toContain('imposto')
  })

  it('aceita margem-alvo negativa e recusa 100%', () => {
    expect(() => calcularSimulacaoML({ ...entradaBase, margemAlvoPct: -10 }, cotacoesBase)).not.toThrow()
    expect(() => calcularSimulacaoML({ ...entradaBase, margemAlvoPct: 100 }, cotacoesBase)).toThrow(RangeError)
  })

  it('guarda a margem exata e exibe a arredondada', () => {
    const entrada: EntradaCalculadoraML = {
      precoVenda: 30,
      custoProduto: 20,
      aliquotaImpostoPct: 0,
      custosFixos: 0,
      custosVariaveis: 0,
      rebate: 0,
      margemAlvoPct: 0,
    }
    const zero = { percentualComissaoPct: 0, taxaFixa: 0, comissaoTotal: 0, frete: 0, proveniencia: 'official' as const }
    const classico = calcularSimulacaoML(entrada, { classico: zero, premium: zero }).modalidades.classico

    expect(classico?.lucro).toBe(10)
    expect(classico?.margemPctExata).toBeCloseTo(100 / 3, 6)
    expect(classico?.margemPct).toBe(33.33)
  })

  it('sem meta: veredito neutro com margem e lucro atuais, sem citar meta nem decidir Comprar', () => {
    const lucro = calcularSimulacaoML({ ...entradaBase, margemAlvoPct: 0 }, cotacoesBase, { semMeta: true })
    expect(lucro.veredito.tipo).toBe('Margem atual')
    expect(JSON.stringify(lucro.veredito)).not.toMatch(/meta/i)
    expect(lucro.veredito.fatores.join(' ')).toMatch(/Margem de .*%/)
    expect(lucro.veredito.fatores.join(' ')).toMatch(/Lucro/)

    const prejuizo = calcularSimulacaoML({ ...entradaBase, precoVenda: 50, margemAlvoPct: 0 }, cotacoesBase, { semMeta: true })
    expect(prejuizo.veredito.tipo).toBe('Margem atual')
    expect(prejuizo.veredito.fatores.join(' ')).toMatch(/Prejuízo/)

    // dados faltando continuam dominando
    expect(calcularSimulacaoML({ ...entradaBase, aliquotaImpostoPct: null }, cotacoesBase, { semMeta: true }).veredito.tipo)
      .toBe('Dados insuficientes')
  })

  it('margem exata negativa no prejuízo, sem exceção', () => {
    const classico = calcularSimulacaoML({ ...entradaBase, precoVenda: 50 }, cotacoesBase).modalidades.classico

    expect(classico?.lucro).toBeLessThan(0)
    expect(classico?.margemPctExata).toBeLessThan(0)
  })
})

describe('calcularSimulacaoML — proveniência com frete desconhecido', () => {
  const semFrete = (proveniencia: 'partial' | 'estimated'): CotacoesPorModalidade => ({
    classico: { ...cotacoesBase.classico, frete: null, proveniencia },
    premium: { ...(cotacoesBase as { premium: typeof cotacoesBase.classico }).premium, frete: null, proveniencia },
  })

  it('cotação estimated sem frete continua estimated (modalidades null não a rebaixam a partial)', () => {
    const resultado = calcularSimulacaoML({ ...entradaBase, categoriaId: 'MLB1' }, semFrete('estimated'))
    expect(resultado.modalidades.classico).toBeNull()
    expect(resultado.proveniencia).toBe('estimated')
  })

  it('cotação partial sem frete continua partial', () => {
    const resultado = calcularSimulacaoML({ ...entradaBase, categoriaId: 'MLB1' }, semFrete('partial'))
    expect(resultado.proveniencia).toBe('partial')
  })
})
