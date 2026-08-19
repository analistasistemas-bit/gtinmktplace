import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { buscarCategoriasMock } = vi.hoisted(() => ({ buscarCategoriasMock: vi.fn() }))

vi.mock('@/lib/categorias-ml', () => ({ buscarCategoriasML: buscarCategoriasMock }))

const { useCategoriasML } = await import('../useCategoriasML')

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useCategoriasML', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    buscarCategoriasMock.mockReset()
  })

  afterEach(() => vi.useRealTimers())

  it('hides results from the previous term while the next term is debouncing', async () => {
    buscarCategoriasMock.mockResolvedValue([{ id: 'MLB1', nome: 'Casa', caminho: 'Casa' }])
    const { result, rerender } = renderHook(({ query }) => useCategoriasML(query), {
      initialProps: { query: 'casa' },
      wrapper,
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(result.current.data).toEqual([{ id: 'MLB1', nome: 'Casa', caminho: 'Casa' }])

    rerender({ query: 'moda' })

    expect(result.current.data).toEqual([])
  })
})
