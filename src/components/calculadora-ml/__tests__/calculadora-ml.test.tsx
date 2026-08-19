import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const atualizarEntrada = vi.fn()
const atualizarTaxasManuais = vi.fn()
const selecionarProduto = vi.fn()
const validarNaApi = vi.fn()

const estadoBase = {
  entrada: {
    precoVenda: 100,
    custoProduto: 50,
    aliquotaImpostoPct: 0,
    custosFixos: 0,
    custosVariaveis: 0,
    rebate: 0,
    margemAlvoPct: 12,
    categoriaId: undefined,
  },
  atualizarEntrada,
  taxasManuais: { percentualComissaoPct: 12, taxaFixa: 5, frete: 10 },
  atualizarTaxasManuais,
  produtoSelecionado: null,
  selecionarProduto,
  produtos: { data: [], isLoading: false, isError: false, refetch: vi.fn() },
  cotacao: { origem: 'manual' as const, classico: { percentualComissaoPct: 12, taxaFixa: 5, comissaoTotal: 17, frete: 10, proveniencia: 'estimated' as const } },
  statusCotacao: 'estimated' as const,
  aviso: null,
  resultado: {
    peso: null,
    proveniencia: 'estimated' as const,
    modalidades: {
      classico: {
        proveniencia: 'estimated' as const,
        custos: { custoProduto: 50, comissao: 17, frete: 10, imposto: 0, custosFixos: 0, custosVariaveis: 0, rebate: 0, total: 77 },
        lucro: 23,
        margemPct: 23,
        precoEquilibrio: { valor: 87.5, proveniencia: 'estimated' as const, ehProjecao: true as const },
        precoAlvo: { valor: 100, proveniencia: 'estimated' as const, ehProjecao: true as const },
        custoMaximoCompra: 61,
      },
      premium: {
        proveniencia: 'estimated' as const,
        custos: { custoProduto: 50, comissao: 22, frete: 10, imposto: 0, custosFixos: 0, custosVariaveis: 0, rebate: 0, total: 82 },
        lucro: 18,
        margemPct: 18,
        precoEquilibrio: { valor: 87.5, proveniencia: 'estimated' as const, ehProjecao: true as const },
        precoAlvo: { valor: 100, proveniencia: 'estimated' as const, ehProjecao: true as const },
        custoMaximoCompra: 56,
      },
    },
    veredito: { tipo: 'Comprar' as const, fatores: ['Margem atual de 23% atinge a meta de 12%.', 'Lucro estimado de R$ 23,00 por unidade.'] },
  },
  validarNaApi,
  cotacaoMeta: null,
  erroMeta: null,
}

let estado = estadoBase
vi.mock('@/hooks/useCalculadoraML', () => ({ useCalculadoraML: () => estado }))
vi.mock('@/hooks/useCategoriasML', () => ({ useCategoriasML: () => ({ data: [], isLoading: false, isError: false }) }))

import { CalculadoraML } from '../calculadora-ml'

describe('Calculadora ML', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    estado = estadoBase
  })

  it('mantém aviso acionável quando a categoria está vazia', () => {
    render(<CalculadoraML />)

    expect(screen.getByText(/categoria ainda não foi informada/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continuar sem categoria/i })).toBeInTheDocument()
    expect(screen.getAllByText(/estimativa/i).length).toBeGreaterThan(0)
  })

  it('mostra comparação no desktop e alterna modalidade no mobile', async () => {
    const user = userEvent.setup()
    render(<CalculadoraML />)

    expect(screen.getByRole('heading', { name: /clássico/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /premium/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /ver premium/i }))
    expect(screen.getByText('R$ 22,00')).toBeInTheDocument()
  })

  it('expõe proveniência, veredito explicado e validação do preço projetado', async () => {
    const user = userEvent.setup()
    render(<CalculadoraML />)

    expect(screen.getByText(/taxas manuais estimadas/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /comprar/i })).toBeInTheDocument()
    expect(screen.getByText(/margem atual de 23%/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /validar preço projetado/i }))
    expect(validarNaApi).toHaveBeenCalledOnce()
  })

  it('renderiza estados de carregamento e erro da busca de categoria', () => {
    estado = { ...estadoBase, produtos: { data: undefined, isLoading: true, isError: false, refetch: vi.fn() } }
    render(<CalculadoraML />)
    expect(screen.getByText(/carregando produtos/i)).toBeInTheDocument()
  })
})
