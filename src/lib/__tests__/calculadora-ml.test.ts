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
    const cotacaoManualSemPremium = {
      origem: 'manual',
      classico: {
        percentualComissaoPct: 11.5,
        taxaFixa: 0,
        comissaoTotal: 11.5,
        frete: 16.15,
        proveniencia: 'estimated',
      },
    } as unknown as CotacoesPorModalidade

    const resultado = calcularSimulacaoML(entradaBase, cotacaoManualSemPremium)

    expect(resultado.modalidades.premium?.custos.comissao).toBe(16.5)
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
})
