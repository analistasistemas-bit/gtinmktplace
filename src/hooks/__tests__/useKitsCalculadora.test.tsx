import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  calcularSimulacaoML,
  type CotacoesOficiaisPorModalidade,
  type EntradaCalculadoraML,
  type Proveniencia,
} from '@/lib/calculadora-ml'
import { dimensoesDoKit, type CotarEm } from '@/lib/calculadora-ml-preco'
import { useKitsCalculadora } from '../useKitsCalculadora'

const DIM = { alturaCm: 5, larguraCm: 5, comprimentoCm: 15, pesoKg: 0.3 }

const ENTRADA: EntradaCalculadoraML = {
  precoVenda: 100,
  custoProduto: 30,
  aliquotaImpostoPct: 10,
  custosFixos: 0,
  custosVariaveis: 0,
  rebate: 0,
  margemAlvoPct: 0,
  dimensoes: DIM,
  categoriaId: 'MLB1',
  modalidadeParaDecisao: 'classico',
}

/** 12% de comissão, sem taxa fixa, frete 20 — tarifa com a proveniência pedida. */
function cotacao(preco: number, proveniencia: Proveniencia = 'official', frete: number | null = 20): CotacoesOficiaisPorModalidade {
  const custos = { percentualComissaoPct: 12, taxaFixa: 0, comissaoTotal: Math.round(preco * 12) / 100, frete, proveniencia }
  return { origem: 'official', classico: custos, premium: { ...custos } }
}

const cotarOficial = () => vi.fn<CotarEm>(async (preco) => cotacao(preco))

const resultadoUnidade = calcularSimulacaoML(ENTRADA, cotacao(100), { semMeta: true }).modalidades.classico

type Args = Parameters<typeof useKitsCalculadora>[0]
const args = (parcial: Partial<Args> = {}): Args => ({
  entrada: ENTRADA,
  modalidade: 'classico',
  margemPct: 38,
  quantidadeN: 1,
  resultadoUnidade,
  cotarEm: cotarOficial(),
  aguardando: false,
  ...parcial,
})

async function avancar(ms = 400) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useKitsCalculadora', () => {
  it('colunas 1 · 2 · 3 e N só quando N ∉ {1,2,3}', () => {
    const { result, rerender } = renderHook((p: Args) => useKitsCalculadora(p), { initialProps: args({ quantidadeN: 2 }) })
    expect(result.current.map((c) => c.quantidade)).toEqual([1, 2, 3])
    rerender(args({ quantidadeN: 5 }))
    expect(result.current.map((c) => c.quantidade)).toEqual([1, 2, 3, 5])
  })

  it('coluna 1 é o resultado da unidade, sem chamar a API', async () => {
    const cotarEm = cotarOficial()
    const { result } = renderHook(() => useKitsCalculadora(args({ cotarEm, aguardando: true })))
    await avancar(1000)
    expect(cotarEm).not.toHaveBeenCalled()
    expect(result.current[0]).toMatchObject({
      quantidade: 1,
      preco: 100,
      precoUnitario: 100,
      frete: resultadoUnidade!.custos.frete,
      comissao: resultadoUnidade!.custos.comissao,
      lucro: resultadoUnidade!.lucro,
      margemPct: resultadoUnidade!.margemPctExata,
      status: 'ok',
    })
  })

  it('coluna 2: cota custo × 2 nas medidas do kit e mantém a margem informada', async () => {
    const cotarEm = cotarOficial()
    const { result } = renderHook(() => useKitsCalculadora(args({ cotarEm })))
    expect(result.current[1].status).toBe('calculando')
    await avancar()
    expect(cotarEm).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({
      custoProduto: 60,
      dimensoes: dimensoesDoKit(DIM, 2),
    }))
    // base 60 + frete 20 = 80; 80 / (1 − 0,12 − 0,10 − 0,38) = 200.
    expect(result.current[1]).toMatchObject({
      quantidade: 2, custo: 60, preco: 200, precoUnitario: 100, frete: 20, comissao: 24, lucro: 76, status: 'ok',
    })
    expect(result.current[1].margemPct).toBeCloseTo(38, 9)
    expect(result.current[2]).toMatchObject({ quantidade: 3, custo: 90, status: 'ok' })
  })

  it.each([
    ['sem categoria', { entrada: { ...ENTRADA, categoriaId: undefined } }],
    ['sem dimensões', { entrada: { ...ENTRADA, dimensoes: undefined } }],
    ['imposto desconhecido', { entrada: { ...ENTRADA, aliquotaImpostoPct: null } }],
    ['margem desconhecida', { margemPct: null }],
  ] as const)('%s → colunas ≥ 2 sem_dados, só o custo do kit, sem API', async (_, parcial) => {
    const cotarEm = cotarOficial()
    const { result } = renderHook(() => useKitsCalculadora(args({ ...parcial, cotarEm })))
    await avancar()
    expect(cotarEm).not.toHaveBeenCalled()
    expect(result.current[1]).toEqual({
      quantidade: 2, custo: 60, preco: null, precoUnitario: null, frete: null, comissao: null, lucro: null, margemPct: null, status: 'sem_dados',
    })
  })

  it('aguardando → colunas ≥ 2 calculando, sem chamar cotarEm', async () => {
    const cotarEm = cotarOficial()
    const { result } = renderHook(() => useKitsCalculadora(args({ cotarEm, aguardando: true })))
    await avancar(1000)
    expect(cotarEm).not.toHaveBeenCalled()
    expect(result.current.slice(1).map((c) => c.status)).toEqual(['calculando', 'calculando'])
  })

  it('frete manual nunca é herdado: cotação do kit não oficial → frete null, não confirmado', async () => {
    // `cotacaoCalculadora` põe o frete manual confirmado em tarifa partial/estimated.
    const cotarEm = vi.fn<CotarEm>(async (preco) => cotacao(preco, 'partial', 15))
    const { result } = renderHook(() => useKitsCalculadora(args({ cotarEm })))
    await avancar()
    expect(cotarEm).toHaveBeenCalled()
    expect(result.current[1]).toMatchObject({ frete: null, preco: null, lucro: null, status: 'nao_confirmado' })
  })

  it('cotarEm que falha → não confirmado', async () => {
    const cotarEm = vi.fn<CotarEm>(async () => { throw new Error('fora') })
    const { result } = renderHook(() => useKitsCalculadora(args({ cotarEm })))
    await avancar()
    expect(result.current[1].status).toBe('nao_confirmado')
  })

  it('re-render com valores iguais e mesma cotarEm não recota', async () => {
    const cotarEm = cotarOficial()
    const { rerender } = renderHook((p: Args) => useKitsCalculadora(p), { initialProps: args({ cotarEm }) })
    await avancar()
    const chamadas = cotarEm.mock.calls.length
    rerender(args({ cotarEm, entrada: { ...ENTRADA, dimensoes: { ...DIM } } }))
    await avancar(1000)
    expect(cotarEm).toHaveBeenCalledTimes(chamadas)
  })

  it('mudar N não recota as colunas 2 e 3 já calculadas', async () => {
    const cotarEm = cotarOficial()
    const { result, rerender } = renderHook((p: Args) => useKitsCalculadora(p), { initialProps: args({ cotarEm }) })
    await avancar()
    const custos = () => cotarEm.mock.calls.map(([, e]) => e.custoProduto)
    const antes = custos().filter((c) => c !== 150).length
    rerender(args({ cotarEm, quantidadeN: 5 }))
    expect(result.current.slice(1, 3).map((c) => c.status)).toEqual(['ok', 'ok'])
    await avancar()
    expect(custos().filter((c) => c !== 150)).toHaveLength(antes)
    expect(custos()).toContain(150)
    expect(result.current.map((c) => c.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
  })

  it('voltar de aguardando com a mesma entrada não recota', async () => {
    const cotarEm = cotarOficial()
    const { result, rerender } = renderHook((p: Args) => useKitsCalculadora(p), { initialProps: args({ cotarEm }) })
    await avancar()
    const chamadas = cotarEm.mock.calls.length
    rerender(args({ cotarEm, aguardando: true }))
    await avancar()
    rerender(args({ cotarEm }))
    expect(result.current[1]).toMatchObject({ status: 'ok', preco: 200 })
    await avancar(1000)
    expect(cotarEm).toHaveBeenCalledTimes(chamadas)
  })

  it('debounce 400 ms: edições rápidas só cotam a última', async () => {
    const cotarEm = cotarOficial()
    const { rerender } = renderHook((p: Args) => useKitsCalculadora(p), { initialProps: args({ cotarEm, margemPct: 20 }) })
    await avancar(200)
    rerender(args({ cotarEm, margemPct: 38 }))
    await avancar(399)
    expect(cotarEm).not.toHaveBeenCalled()
    await avancar(1)
    expect(cotarEm).toHaveBeenCalled()
  })

  it('só a última rodada publica', async () => {
    let soltar: () => void = () => {}
    const lenta = new Promise<void>((r) => { soltar = r })
    const cotarLenta = vi.fn<CotarEm>(async (preco) => { await lenta; return cotacao(preco, 'official', 999) })
    const cotarRapida = cotarOficial()
    const { result, rerender } = renderHook((p: Args) => useKitsCalculadora(p), { initialProps: args({ cotarEm: cotarLenta }) })
    await avancar()
    rerender(args({ cotarEm: cotarRapida }))
    await avancar()
    expect(result.current[1]).toMatchObject({ preco: 200, frete: 20 })
    soltar()
    await avancar()
    expect(result.current[1]).toMatchObject({ preco: 200, frete: 20 })
  })
})
