import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QK } from '@/lib/queries'

const { fetchKitsVariacaoMock } = vi.hoisted(() => ({ fetchKitsVariacaoMock: vi.fn() }))

vi.mock('@/lib/kit-variacao-edge', async () => {
  const actual = await vi.importActual<typeof import('@/lib/kit-variacao-edge')>('@/lib/kit-variacao-edge')
  return { ...actual, fetchKitsVariacao: fetchKitsVariacaoMock }
})

const { useKitsVariacao, QK_KITS_VARIACAO } = await import('../useKitsVariacao')

const kit = (passo: string | null, status = 'publicado') => [{
  id: 'k1', status,
  transferencia: passo ? { id: 't1', tipo: 'desmontar', estado: 'ativa', passo } : null,
}]

function montar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidar = vi.spyOn(queryClient, 'invalidateQueries')
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const recarregouPublicados = () => invalidar.mock.calls.some(([f]) => f?.queryKey === QK.publicados)
  return { queryClient, wrapper, invalidar, recarregouPublicados }
}

describe('useKitsVariacao: recarrega Publicados quando a etapa do kit anda', () => {
  beforeEach(() => fetchKitsVariacaoMock.mockReset())

  it('não recarrega na primeira leitura nem em leitura sem mudança', async () => {
    fetchKitsVariacaoMock.mockResolvedValue(kit('pausar'))
    const { queryClient, wrapper, recarregouPublicados } = montar()
    const { result } = renderHook(() => useKitsVariacao(true), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    await queryClient.refetchQueries({ queryKey: QK_KITS_VARIACAO })
    expect(fetchKitsVariacaoMock).toHaveBeenCalledTimes(2)
    expect(recarregouPublicados()).toBe(false)
  })

  it('recarrega quando o passo muda e quando a transferência termina', async () => {
    fetchKitsVariacaoMock.mockResolvedValueOnce(kit('pausar'))
    const { queryClient, wrapper, invalidar, recarregouPublicados } = montar()
    const { result } = renderHook(() => useKitsVariacao(true), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())

    fetchKitsVariacaoMock.mockResolvedValueOnce(kit('aumentar'))
    await queryClient.refetchQueries({ queryKey: QK_KITS_VARIACAO })
    await waitFor(() => expect(recarregouPublicados()).toBe(true))

    invalidar.mockClear()
    fetchKitsVariacaoMock.mockResolvedValueOnce(kit(null))
    await queryClient.refetchQueries({ queryKey: QK_KITS_VARIACAO })
    await waitFor(() => expect(recarregouPublicados()).toBe(true))
  })
})
