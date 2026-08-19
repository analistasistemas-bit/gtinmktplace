import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const atualizarEntrada = vi.fn()
const atualizarTaxasManuais = vi.fn()
const selecionarProduto = vi.fn()
const validarNaApi = vi.fn()
const refetchCategorias = vi.fn()

let categoriasState = { data: [], isLoading: false, isError: false, refetch: refetchCategorias }

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
vi.mock('@/hooks/useCategoriasML', () => ({ useCategoriasML: () => categoriasState }))

import { CalculadoraML } from '../calculadora-ml'
import { BuscaCategoriaML } from '../busca-categoria-ml'
import { FormularioCalculadoraML } from '../formulario-calculadora-ml'

describe('Calculadora ML', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    estado = estadoBase
    categoriasState = { data: [], isLoading: false, isError: false, refetch: refetchCategorias }
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

  it('mantém dimensões parciais como rascunho sem enviar zeros ao motor', () => {
    const onEntrada = vi.fn()
    const entrada = { ...estadoBase.entrada }
    const props = {
      entrada,
      taxas: estadoBase.taxasManuais,
      produtos: [],
      produtoSelecionado: null,
      produtosCarregando: false,
      onEntrada,
      onTaxas: vi.fn(),
      onProduto: vi.fn(),
    }
    render(<FormularioCalculadoraML {...props} />)

    fireEvent.change(screen.getByLabelText('Altura (cm)'), { target: { value: '10' } })
    expect(onEntrada).not.toHaveBeenCalledWith(expect.objectContaining({ dimensoes: expect.anything() }))
    expect(screen.getByLabelText('Altura (cm)')).toHaveValue(10)
  })

  it('oferece retry real quando a busca de categoria falha', async () => {
    const user = userEvent.setup()
    categoriasState = { data: [], isLoading: false, isError: true, refetch: refetchCategorias }
    render(<BuscaCategoriaML onSelect={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: /buscar categoria/i }), 'calçados')
    await user.click(screen.getByRole('button', { name: /buscar categoria/i }))
    expect(refetchCategorias).toHaveBeenCalledOnce()
  })

  it('limita entradas negativas e percentuais acima de 100 com orientação', () => {
    const onEntrada = vi.fn()
    const onTaxas = vi.fn()
    render(<FormularioCalculadoraML entrada={estadoBase.entrada} taxas={estadoBase.taxasManuais} produtos={[]} produtoSelecionado={null} produtosCarregando={false} onEntrada={onEntrada} onTaxas={onTaxas} onProduto={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Custo de compra (R$)'), { target: { value: '-5' } })
    fireEvent.change(screen.getByLabelText('Margem-alvo (%)'), { target: { value: '120' } })
    fireEvent.change(screen.getByLabelText('Comissão (%)'), { target: { value: '140' } })

    expect(onEntrada).toHaveBeenCalledWith({ custoProduto: 0 })
    expect(onEntrada).toHaveBeenCalledWith({ margemAlvoPct: 100 })
    expect(onTaxas).toHaveBeenCalledWith({ percentualComissaoPct: 100 })
    expect(screen.getAllByText(/entre 0 e 100|não pode ser negativo/i).length).toBeGreaterThanOrEqual(2)
  })

  it('confirma na tela quando o preço projetado foi validado na API', () => {
    estado = { ...estadoBase, cotacaoMeta: { id: 'tarifa-validada' } }
    render(<CalculadoraML />)

    expect(screen.getByText(/preço projetado validado na api/i)).toBeInTheDocument()
    expect(screen.getByText(/oficial.*api ml/i)).toBeInTheDocument()
  })

  it('sincroniza dimensões de produto atualizado e preserva edição parcial subsequente', () => {
    const onEntrada = vi.fn()
    const dimensoesProdutoA = { alturaCm: 10, larguraCm: 20, comprimentoCm: 30, pesoKg: 1 }
    const dimensoesProdutoB = { alturaCm: 40, larguraCm: 50, comprimentoCm: 60, pesoKg: 2 }
    const props = {
      entrada: { ...estadoBase.entrada, dimensoes: dimensoesProdutoA },
      taxas: estadoBase.taxasManuais,
      produtos: [],
      produtoSelecionado: null,
      produtosCarregando: false,
      onEntrada,
      onTaxas: vi.fn(),
      onProduto: vi.fn(),
    }
    const view = render(<FormularioCalculadoraML {...props} />)

    view.rerender(<FormularioCalculadoraML {...props} entrada={{ ...props.entrada, dimensoes: dimensoesProdutoB }} />)
    expect(screen.getByLabelText('Altura (cm)')).toHaveValue(40)
    expect(screen.getByLabelText('Largura (cm)')).toHaveValue(50)

    fireEvent.change(screen.getByLabelText('Altura (cm)'), { target: { value: '0' } })
    view.rerender(<FormularioCalculadoraML {...props} entrada={{ ...props.entrada, dimensoes: undefined }} />)
    expect(screen.getByLabelText('Altura (cm)')).toHaveValue(0)
    expect(screen.getByLabelText('Largura (cm)')).toHaveValue(50)
  })
})
