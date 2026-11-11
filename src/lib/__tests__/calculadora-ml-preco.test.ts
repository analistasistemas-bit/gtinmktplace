import { describe, expect, it, vi } from 'vitest'

import type {
  CotacoesPorModalidade,
  CustosModalidadeML,
  EntradaCalculadoraML,
  Proveniencia,
} from '../calculadora-ml'
import { dimensoesDoKit, entradaDoKit, precoPorMargem } from '../calculadora-ml-preco'

const round2 = (x: number) => Math.round(x * 100) / 100

function custos(p: number, pct: number, extra: Partial<CustosModalidadeML> = {}): CustosModalidadeML {
  return {
    percentualComissaoPct: pct,
    taxaFixa: 0,
    comissaoTotal: round2((p * pct) / 100),
    frete: 0,
    proveniencia: 'official',
    ...extra,
  }
}

/** cotarEm fake: comissão pct(p), taxa fixa 0, frete 0 (ou o informado), proveniência official. */
function fake(pct: (p: number) => number, extra: Partial<CustosModalidadeML> = {}) {
  return vi.fn(async (p: number): Promise<CotacoesPorModalidade> => {
    const c = custos(p, pct(p), extra)
    return { classico: c, premium: c }
  })
}

function entrada(custoProduto: number, aliquotaImpostoPct = 0): EntradaCalculadoraML {
  return {
    precoVenda: 0,
    custoProduto,
    aliquotaImpostoPct,
    custosFixos: 0,
    custosVariaveis: 0,
    rebate: 0,
    margemAlvoPct: 0,
    categoriaId: 'MLB1',
  }
}

describe('dimensoesDoKit', () => {
  it('multiplica o lado menor (empate: o primeiro) e o peso', () => {
    const d = dimensoesDoKit({ alturaCm: 15, larguraCm: 5, comprimentoCm: 5, pesoKg: 0.13 }, 3)

    expect(d).toMatchObject({ alturaCm: 15, larguraCm: 15, comprimentoCm: 5 })
    expect(d.pesoKg).toBeCloseTo(0.39)
    expect(d.alturaCm * d.larguraCm * d.comprimentoCm).toBe(15 * 5 * 5 * 3)
  })
})

describe('entradaDoKit', () => {
  it('multiplica custo e dimensões; custos por kit iguais', () => {
    const e: EntradaCalculadoraML = {
      ...entrada(10, 8),
      custosFixos: 2,
      custosVariaveis: 3,
      rebate: 1,
      dimensoes: { alturaCm: 10, larguraCm: 20, comprimentoCm: 30, pesoKg: 0.5 },
    }
    const kit = entradaDoKit(e, 2)

    expect(kit).toMatchObject({ custoProduto: 20, custosFixos: 2, custosVariaveis: 3, rebate: 1 })
    expect(kit.dimensoes).toEqual(dimensoesDoKit(e.dimensoes!, 2))
    expect(entradaDoKit(entrada(10), 2).dimensoes).toBeUndefined()
  })
})

describe('precoPorMargem', () => {
  it('comissão 0%, custo 1, meta 33 → 1,50 confirmado', async () => {
    const r = await precoPorMargem(entrada(1), 'classico', 33, custos(1, 0), fake(() => 0))

    expect(r?.preco).toBe(1.5)
    expect(r?.confirmado).toBe(true)
  })

  it('comissão 12% arredondada, custo 1, meta 33 → avança centavo até 1,83', async () => {
    const r = await precoPorMargem(entrada(1), 'classico', 33, custos(1, 12), fake(() => 12))

    expect(r?.preco).toBe(1.83)
    expect(r?.confirmado).toBe(true)
  })

  it('comissão 11% + imposto 4%, custo 1, meta 84,26 → 135,20 (6 avanços)', async () => {
    const r = await precoPorMargem(entrada(1, 4), 'classico', 84.26, custos(1, 11), fake(() => 11))

    expect(r?.preco).toBe(135.2)
    expect(r?.confirmado).toBe(true)
  })

  it('denominador ≤ 0 na 1ª faixa sonda a seguinte → 200', async () => {
    const pct = (p: number) => (p < 100 ? 12 : 11)
    const r = await precoPorMargem(entrada(1), 'classico', 88.5, custos(1, 12), fake(pct))

    expect(r?.confirmado).toBe(true)
    expect(r?.preco).toBe(200)
  })

  it('sondagem parte da base completa (com frete) → 20.200 dentro do teto de chamadas', async () => {
    const pct = (p: number) => (p < 10_000 ? 12 : 11)
    const r = await precoPorMargem(entrada(1), 'classico', 88.5, custos(1, 12, { frete: 100 }), fake(pct, { frete: 100 }))

    expect(r?.preco).toBe(20200)
    expect(r?.confirmado).toBe(true)
  })

  it('fronteira de faixa: fica em 47,62 abaixo de 50; sobe a 55,74 quando cai em 14%', async () => {
    const pct = (p: number) => (p < 50 ? 12 : 14)

    const a = await precoPorMargem(entrada(30), 'classico', 25, custos(1, 12), fake(pct))
    expect(a?.preco).toBe(47.62)
    expect(a?.confirmado).toBe(true)

    const b = await precoPorMargem(entrada(34), 'classico', 25, custos(1, 12), fake(pct))
    expect(b?.preco).toBe(55.74)
    expect(b?.lucro).toBe(13.94)
    expect(b?.confirmado).toBe(true)
  })

  it('meta inatingível (95%) → não confirmado, sem lançar, no máximo maxChamadas', async () => {
    const cotarEm = fake(() => 12)
    const r = await precoPorMargem(entrada(1, 8), 'classico', 95, custos(1, 12), cotarEm)

    expect(r === null || r.confirmado === false).toBe(true)
    expect(cotarEm.mock.calls.length).toBeLessThanOrEqual(12)
  })

  it('cotação estimated → preço do candidato, não confirmado, 1 chamada', async () => {
    const e = entrada(10, 8)
    const cotarEm = fake(() => 12, { frete: 5, proveniencia: 'estimated' as Proveniencia })
    const r = await precoPorMargem(e, 'classico', 30, custos(1, 12, { frete: 5 }), cotarEm)

    expect(r?.preco).toBe(30)
    expect(r?.confirmado).toBe(false)
    expect(cotarEm).toHaveBeenCalledTimes(1)
  })

  it('frete null → null após 1 chamada', async () => {
    const cotarEm = fake(() => 12, { frete: null })
    const r = await precoPorMargem(entrada(10), 'classico', 30, custos(1, 12), cotarEm)

    expect(r).toBeNull()
    expect(cotarEm).toHaveBeenCalledTimes(1)
  })

  it('base ≤ 0 (rebate cobre os custos) → null sem cotar', async () => {
    const cotarEm = fake(() => 12)
    const r = await precoPorMargem({ ...entrada(5), rebate: 5 }, 'classico', 30, custos(1, 12), cotarEm)

    expect(r).toBeNull()
    expect(cotarEm).not.toHaveBeenCalled()
  })

  it('cotarEm lança na 1ª chamada → relança', async () => {
    const cotarEm = vi.fn(async () => {
      throw new Error('api fora')
    })
    await expect(precoPorMargem(entrada(30), 'classico', 25, custos(1, 12), cotarEm)).rejects.toThrow('api fora')
  })

  it('cotarEm lança depois de um seguro → devolve o seguro', async () => {
    let n = 0
    const cotarEm = vi.fn(async (p: number): Promise<CotacoesPorModalidade> => {
      if (n++ > 0) throw new Error('api fora')
      const c = custos(p, 12)
      return { classico: c, premium: c }
    })
    // inicial 14% → 30/0,61 = 49,1803 → 49,19; a 12% atinge 25% (27,0%) e o próximo candidato (47,62) lança.
    const r = await precoPorMargem(entrada(30), 'classico', 25, custos(1, 14), cotarEm)

    expect(r?.preco).toBe(49.19)
    expect(r?.confirmado).toBe(true)
    expect(cotarEm).toHaveBeenCalledTimes(2)
  })

  it('cotação manual com Premium usa o premium derivado (+5 p.p.)', async () => {
    const cotarEm = vi.fn(async (p: number): Promise<CotacoesPorModalidade> => ({
      origem: 'manual',
      classico: custos(p, 12),
    }))
    const r = await precoPorMargem(entrada(30), 'premium', 25, custos(1, 17), cotarEm)

    // 30 / (1 − 0,17 − 0,25) → 51,73: premium = 6,21 + 2,59 = 8,80, margem 24,99% (não atinge);
    // 51,74 → margem 25,01%. Manual é estimated → não confirma e para ao atingir.
    expect(r?.preco).toBe(51.74)
    expect(r?.confirmado).toBe(false)
    expect(cotarEm).toHaveBeenCalledTimes(2)
  })
})
