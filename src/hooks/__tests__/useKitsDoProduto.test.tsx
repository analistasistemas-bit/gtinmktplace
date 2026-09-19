import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KitVinculado } from '@/lib/queries'

const { fetchKitsDoProdutoMock } = vi.hoisted(() => ({ fetchKitsDoProdutoMock: vi.fn() }))

vi.mock('@/lib/queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/queries')>('@/lib/queries')
  return { ...actual, fetchKitsDoProduto: fetchKitsDoProdutoMock }
})

const { useKitsDoProduto } = await import('../useKitsDoProduto')

function kit(overrides: Partial<KitVinculado>): KitVinculado {
  return {
    familiaId: '1',
    codigoPai: 'PAI1',
    multiplicador: 3,
    status: 'pronto',
    mlPermalink: null,
    mlItemId: null,
    criadoEm: '2026-01-01',
    ...overrides,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useKitsDoProduto refetchInterval', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchKitsDoProdutoMock.mockReset()
  })

  afterEach(() => vi.useRealTimers())

  it('com poll=true, refaz a busca a cada 2500ms enquanto houver kit em trânsito (publicando)', async () => {
    fetchKitsDoProdutoMock.mockResolvedValue([kit({ status: 'publicando' })])
    renderHook(() => useKitsDoProduto('PAI1', true, true), { wrapper })

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchKitsDoProdutoMock).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
    expect(fetchKitsDoProdutoMock).toHaveBeenCalledTimes(2)
  })

  it('com poll=true, NÃO polla para status "pronto" (repouso: aguardando base/reenvio, não trânsito)', async () => {
    fetchKitsDoProdutoMock.mockResolvedValue([kit({ status: 'pronto' })])
    renderHook(() => useKitsDoProduto('PAI1', true, true), { wrapper })

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchKitsDoProdutoMock).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchKitsDoProdutoMock).toHaveBeenCalledTimes(1)
  })

  it('com poll=true, para de refazer a busca quando todos os kits ficam terminais', async () => {
    fetchKitsDoProdutoMock.mockResolvedValue([kit({ status: 'publicado' }), kit({ familiaId: '2', status: 'erro' })])
    renderHook(() => useKitsDoProduto('PAI1', true, true), { wrapper })

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchKitsDoProdutoMock).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchKitsDoProdutoMock).toHaveBeenCalledTimes(1)
  })

  it('com poll=false (default), nunca refaz a busca mesmo com kit não-terminal', async () => {
    fetchKitsDoProdutoMock.mockResolvedValue([kit({ status: 'publicando' })])
    renderHook(() => useKitsDoProduto('PAI1', true), { wrapper })

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchKitsDoProdutoMock).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchKitsDoProdutoMock).toHaveBeenCalledTimes(1)
  })
})
