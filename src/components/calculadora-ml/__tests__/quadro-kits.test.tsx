import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColunaKit } from '@/hooks/useKitsCalculadora'
import type { EntradaCalculadoraML } from '@/lib/calculadora-ml'

const { useKitsMock } = vi.hoisted(() => ({ useKitsMock: vi.fn() }))
vi.mock('@/hooks/useKitsCalculadora', () => ({ useKitsCalculadora: useKitsMock }))

import { QuadroKits } from '../quadro-kits'

const coluna = (quantidade: number, parcial: Partial<ColunaKit> = {}): ColunaKit => ({
  quantidade, custo: 30 * quantidade, preco: 100 * quantidade, precoUnitario: 100, frete: 20, comissao: 12 * quantidade, lucro: 38 * quantidade, margemPct: 38, status: 'ok', ...parcial,
})

const ENTRADA: EntradaCalculadoraML = {
  precoVenda: 100, custoProduto: 30, aliquotaImpostoPct: 10, custosFixos: 0, custosVariaveis: 0, rebate: 0, margemAlvoPct: 0,
}
const props = {
  entrada: ENTRADA, modalidade: 'classico' as const, margemPct: 38, resultadoUnidade: null, cotarEm: vi.fn(), aguardando: false,
}
const ultimoN = () => useKitsMock.mock.lastCall![0].quantidadeN

beforeEach(() => {
  useKitsMock.mockReset()
  useKitsMock.mockImplementation(({ quantidadeN }: { quantidadeN: number }) =>
    [1, 2, 3, ...([1, 2, 3].includes(quantidadeN) ? [] : [quantidadeN])].map((q) => coluna(q)))
})

describe('QuadroKits', () => {
  it('N começa em 1, é inteiro ≥ 1 e vazio/0 volta a 1', () => {
    render(<QuadroKits {...props} />)
    expect(ultimoN()).toBe(1)
    const campo = screen.getByLabelText(/quantidade no kit/i)
    fireEvent.change(campo, { target: { value: '5' } })
    expect(ultimoN()).toBe(5)
    expect(screen.getByRole('columnheader', { name: /kit de 5/i })).toBeInTheDocument()
    fireEvent.change(campo, { target: { value: '2,7' } })
    expect(ultimoN()).toBe(2)
    fireEvent.change(campo, { target: { value: '0' } })
    expect(ultimoN()).toBe(1)
    fireEvent.change(campo, { target: { value: '' } })
    expect(ultimoN()).toBe(1)
    fireEvent.blur(campo)
    expect(campo).toHaveValue('1')
  })

  it('repassa margem, modalidade e aguardando ao hook', () => {
    render(<QuadroKits {...props} aguardando margemPct={23} modalidade="premium" />)
    expect(useKitsMock.mock.lastCall![0]).toMatchObject({ margemPct: 23, modalidade: 'premium', aguardando: true })
  })

  it('explica os custos por kit e marca coluna não confirmada / frete desconhecido', () => {
    useKitsMock.mockImplementation(() => [
      coluna(1),
      coluna(2, { status: 'nao_confirmado', preco: null, precoUnitario: null, frete: null, lucro: null, margemPct: null, comissao: null }),
      coluna(3, { status: 'calculando' }),
    ])
    render(<QuadroKits {...props} />)
    expect(screen.getByText('Custos fixos, variáveis e rebate considerados por kit.')).toBeInTheDocument()
    expect(screen.getByText(/não confirmado/i)).toBeInTheDocument()
    expect(screen.getByText(/calculando/i)).toBeInTheDocument()
    expect(screen.getByText(/desconhecido/i)).toBeInTheDocument()
    expect(screen.getByText('R$ 38,00')).toBeInTheDocument()
  })
})
