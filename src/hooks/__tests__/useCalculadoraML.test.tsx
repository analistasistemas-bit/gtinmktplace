import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tarifa } from '@/lib/tarifa'

const { calcularTarifaMock, fetchProdutosMock } = vi.hoisted(() => ({
  calcularTarifaMock: vi.fn(),
  fetchProdutosMock: vi.fn(),
}))

vi.mock('@/lib/tarifa', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tarifa')>(),
  calcularTarifaML: calcularTarifaMock,
}))
vi.mock('@/lib/produtos-saldo', () => ({ fetchProdutosEstoqueResumo: fetchProdutosMock }))

const { useCalculadoraML } = await import('../useCalculadoraML')

const tarifaOficial = (comissao = 16): Tarifa => ({
  classico: { percentual: comissao - 5, fixa: 6, comissao: 17, imposto: 0, recebe: 83 },
  premium: { percentual: comissao, fixa: 6, comissao: 22, imposto: 0, recebe: 78 },
  frete: 12,
})

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

async function avancarCotacao() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300)
  })
}

describe('useCalculadoraML', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    calcularTarifaMock.mockReset()
    fetchProdutosMock.mockReset()
    fetchProdutosMock.mockResolvedValue({ kpis: {}, produtos: [] })
  })

  afterEach(() => vi.useRealTimers())

  it('usa a cotação oficial da categoria para as duas modalidades', async () => {
    calcularTarifaMock.mockResolvedValue(tarifaOficial())
    const { result } = renderHook(() => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1' }), { wrapper })

    await avancarCotacao()

    expect(result.current.resultado.modalidades.premium?.custos.comissao).toBe(22)
    expect(result.current.resultado.proveniencia).toBe('official')
    expect(result.current.cotacao.origem).toBe('official')
  })

  it('sem categoria conserva taxas manuais e sinaliza estimativa', () => {
    const { result } = renderHook(() => useCalculadoraML({ precoVenda: 100 }), { wrapper })

    expect(result.current.cotacao.origem).toBe('manual')
    expect(result.current.resultado.proveniencia).toBe('estimated')
    expect(result.current.aviso).toMatch(/categoria/i)
    expect(calcularTarifaMock).not.toHaveBeenCalled()
  })

  it('falha da API preserva a simulação manual claramente estimada', async () => {
    calcularTarifaMock.mockResolvedValue(null)
    const { result } = renderHook(() => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1' }), { wrapper })

    await avancarCotacao()

    expect(result.current.cotacao.origem).toBe('manual')
    expect(result.current.resultado.proveniencia).toBe('estimated')
    expect(result.current.aviso).toMatch(/indisponível/i)
  })

  it('recota ao alterar preço, categoria ou dimensões', async () => {
    calcularTarifaMock.mockResolvedValue(tarifaOficial())
    const { result } = renderHook(() => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1' }), { wrapper })

    await avancarCotacao()
    act(() => result.current.atualizarEntrada({ precoVenda: 110 }))
    await avancarCotacao()
    act(() => result.current.atualizarEntrada({ categoriaId: 'MLB2' }))
    await avancarCotacao()
    act(() => result.current.atualizarEntrada({ dimensoes: { alturaCm: 10, larguraCm: 20, comprimentoCm: 30, pesoKg: 1 } }))
    await avancarCotacao()

    expect(calcularTarifaMock).toHaveBeenCalledTimes(4)
    expect(calcularTarifaMock).toHaveBeenLastCalledWith(110, 'MLB2', {
      alturaCm: 10, larguraCm: 20, comprimentoCm: 30, pesoGramas: 1000,
    }, 0)
  })

  it('descarta a resposta antiga para não sobrescrever uma recotação mais nova', async () => {
    let resolverAntigo: ((tarifa: Tarifa | null) => void) | undefined
    calcularTarifaMock
      .mockImplementationOnce(() => new Promise<Tarifa | null>((resolve) => { resolverAntigo = resolve }))
      .mockResolvedValueOnce(tarifaOficial(21))
    const { result } = renderHook(() => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1' }), { wrapper })

    await avancarCotacao()
    act(() => result.current.atualizarEntrada({ precoVenda: 200 }))
    await avancarCotacao()
    await act(async () => { await Promise.resolve() })
    expect(calcularTarifaMock).toHaveBeenCalledTimes(2)
    expect(result.current.cotacao.origem).toBe('official')
    expect('premium' in result.current.cotacao && result.current.cotacao.premium.percentualComissaoPct).toBe(21)
    await act(async () => { resolverAntigo?.(tarifaOficial(16)) })

    expect(result.current.entrada.precoVenda).toBe(200)
    expect(result.current.cotacao.origem).toBe('official')
    expect('premium' in result.current.cotacao && result.current.cotacao.premium.percentualComissaoPct).toBe(21)
  })
})
