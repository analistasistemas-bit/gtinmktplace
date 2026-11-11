import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { useCalculadoraML } from '@/hooks/useCalculadoraML'

const atualizarEntrada = vi.fn()
const atualizarTaxasManuais = vi.fn()
const selecionarProduto = vi.fn()
const editarMargem = vi.fn()
const editarPreco = vi.fn()
const refetchCategorias = vi.fn()

type HookState = ReturnType<typeof useCalculadoraML>
type EstadoCalculadoraMock = Omit<HookState, 'produtos'> & {
  produtos: Pick<HookState['produtos'], 'data' | 'isLoading' | 'isError' | 'refetch'>
}

const produtosData: NonNullable<HookState['produtos']['data']> = {
  kpis: { produtos: 0, skus: 0, unidades: 0, skusSemEstoque: 0, valorEmEstoque: 0, skusSemCusto: 0 },
  produtos: [],
}

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
  taxasManuais: { percentualComissaoPct: 12, taxaFixa: 5, frete: 10, freteRealmenteZero: false },
  atualizarTaxasManuais,
  produtoSelecionado: null,
  selecionarProduto,
  produtos: { data: produtosData, isLoading: false, isError: false, refetch: vi.fn() },
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
        margemPctExata: 23,
        precoEquilibrio: { valor: 87.5, proveniencia: 'estimated' as const, ehProjecao: true as const },
        precoAlvo: { valor: 100, proveniencia: 'estimated' as const, ehProjecao: true as const },
        custoMaximoCompra: 61,
        sensibilidade: {
          custoCompraMais10Pct: { lucro: 18, variacaoLucro: -5 },
          precoVendaMenos5Pct: { lucro: 19.07, variacaoLucro: -3.93 },
          freteMais5: { lucro: 18, variacaoLucro: -5 },
        },
      },
      premium: {
        proveniencia: 'estimated' as const,
        custos: { custoProduto: 50, comissao: 22, frete: 10, imposto: 0, custosFixos: 0, custosVariaveis: 0, rebate: 0, total: 82 },
        lucro: 18,
        margemPct: 18,
        margemPctExata: 18,
        precoEquilibrio: { valor: 87.5, proveniencia: 'estimated' as const, ehProjecao: true as const },
        precoAlvo: { valor: 100, proveniencia: 'estimated' as const, ehProjecao: true as const },
        custoMaximoCompra: 56,
        sensibilidade: {
          custoCompraMais10Pct: { lucro: 13, variacaoLucro: -5 },
          precoVendaMenos5Pct: { lucro: 14.32, variacaoLucro: -3.68 },
          freteMais5: { lucro: 13, variacaoLucro: -5 },
        },
      },
    },
    veredito: { tipo: 'Comprar' as const, fatores: ['Margem atual de 23% atinge a meta de 12%.', 'Lucro estimado de R$ 23,00 por unidade.'] },
  },
  editarPreco,
  editarMargem,
  cotarEm: vi.fn(),
  metaSolicitada: 12 as number | null,
  metaStatus: null,
  ultimoEditado: 'preco' as const,
  margemEfetiva: 23,
  margemExibida: 23,
  modalidadeAtiva: 'classico' as const,
  modalidadeDoAnuncio: null,
  setModalidadeAtiva: vi.fn(),
  avisosProduto: [],
  categoriaNome: null,
  variacaoUsada: null,
  anuncio: null,
}

let estado: EstadoCalculadoraMock = estadoBase
// A modalidade ativa vive no hook (Task 4): o mock guarda estado para a troca re-renderizar.
vi.mock('@/hooks/useCalculadoraML', () => ({
  useCalculadoraML: () => {
    const [modalidadeAtiva, setModalidadeAtiva] = useState(estado.modalidadeAtiva)
    return { ...estado, modalidadeAtiva, setModalidadeAtiva }
  },
}))
vi.mock('@/hooks/useCategoriasML', () => ({ useCategoriasML: () => categoriasState }))

import { CalculadoraML } from '../calculadora-ml'
import { BuscaCategoriaML } from '../busca-categoria-ml'
import { FormularioCalculadoraML, parseNumeroBR } from '../formulario-calculadora-ml'

const propsForm = () => ({
  entrada: estadoBase.entrada as HookState['entrada'],
  taxas: estadoBase.taxasManuais,
  produtos: [],
  produtoSelecionado: null,
  produtosCarregando: false,
  onEntrada: vi.fn(),
  onTaxas: vi.fn(),
  onProduto: vi.fn(),
  onPreco: vi.fn(),
  onMargem: vi.fn(),
  margemExibida: 23 as number | null,
  metaStatus: null as HookState['metaStatus'],
  metaSolicitada: null as number | null,
  modalidade: 'classico' as const,
  onModalidade: vi.fn(),
})

describe('parseNumeroBR', () => {
  it.each([
    ['12,5', 12.5], ['1.234,56', 1234.56], ['R$ 3,04', 3.04], ['-5', -5], ['12.5', 12.5],
    ['0.130', 0.13], ['1.234', 1.234], ['1.234.567', 1234567], ['', null], ['abc', null], ['-', null], ['1,2,3', null],
  ])('%j → %j', (texto, esperado) => {
    expect(parseNumeroBR(texto)).toBe(esperado)
  })
})

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

    expect(screen.getByRole('heading', { name: /^clássico$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^premium$/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /ver premium/i }))
    expect(screen.getByText('R$ 22,00')).toBeInTheDocument()
  })

  it('renders numeric sensitivity for the active modality', async () => {
    const user = userEvent.setup()
    render(<CalculadoraML />)

    expect(screen.getByText(/preço de venda -5%/i)).toBeInTheDocument()
    expect(screen.getByText(/3,93/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /ver premium/i }))
    expect(screen.getByText(/3,68/)).toBeInTheDocument()
  })

  it('expõe proveniência e veredito explicado, sem botão de validar preço projetado', () => {
    render(<CalculadoraML />)

    expect(screen.getByText(/taxas manuais estimadas/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /comprar/i })).toBeInTheDocument()
    expect(screen.getByText(/margem atual de 23%/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /validar preço projetado/i })).toBeNull()
  })

  it('renderiza estados de carregamento e erro da busca de categoria', () => {
    estado = { ...estadoBase, produtos: { data: undefined, isLoading: true, isError: false, refetch: vi.fn() } }
    render(<CalculadoraML />)
    expect(screen.getByText(/carregando produtos/i)).toBeInTheDocument()
  })

  it('mantém dimensões parciais como rascunho sem enviar zeros ao motor', () => {
    const props = propsForm()
    render(<FormularioCalculadoraML {...props} />)

    fireEvent.change(screen.getByLabelText('Altura (cm)'), { target: { value: '10' } })
    expect(props.onEntrada).not.toHaveBeenCalledWith(expect.objectContaining({ dimensoes: expect.anything() }))
    expect(screen.getByLabelText('Altura (cm)')).toHaveValue('10')
  })

  it('oferece retry real quando a busca de categoria falha', async () => {
    const user = userEvent.setup()
    categoriasState = { data: [], isLoading: false, isError: true, refetch: refetchCategorias }
    render(<BuscaCategoriaML onSelect={vi.fn()} />)

    await user.type(screen.getByRole('textbox', { name: /buscar categoria/i }), 'calçados')
    await user.click(screen.getByRole('button', { name: /buscar categoria/i }))
    expect(refetchCategorias).toHaveBeenCalledOnce()
  })

  it('mostra erro em vez de clamp silencioso: negativo, margem >= 100, comissão > 95', () => {
    const props = propsForm()
    render(<FormularioCalculadoraML {...props} />)

    fireEvent.change(screen.getByLabelText('Custo de compra (R$)'), { target: { value: '-5' } })
    fireEvent.change(screen.getByLabelText('Margem (%)'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText('Comissão (%)'), { target: { value: '140' } })

    expect(props.onEntrada).not.toHaveBeenCalled()
    expect(props.onMargem).not.toHaveBeenCalled()
    expect(props.onTaxas).not.toHaveBeenCalled()
    expect(screen.getAllByRole('alert')).toHaveLength(3)
  })

  it('margem aceita negativo e < 100; imposto vazio vira null; demais vazios viram 0', () => {
    const props = propsForm()
    render(<FormularioCalculadoraML {...props} />)

    fireEvent.change(screen.getByLabelText('Margem (%)'), { target: { value: '-12,5' } })
    expect(props.onMargem).toHaveBeenLastCalledWith(-12.5)
    fireEvent.change(screen.getByLabelText('Margem (%)'), { target: { value: '' } })
    expect(props.onMargem).toHaveBeenCalledTimes(1)

    fireEvent.change(screen.getByLabelText('Impostos (%)'), { target: { value: '' } })
    expect(props.onEntrada).toHaveBeenLastCalledWith({ aliquotaImpostoPct: null })
    fireEvent.change(screen.getByLabelText('Custos variáveis (R$)'), { target: { value: '' } })
    expect(props.onEntrada).toHaveBeenLastCalledWith({ custosVariaveis: 0 })
    fireEvent.change(screen.getByLabelText('Preço de venda (R$)'), { target: { value: '1.234,56' } })
    expect(props.onPreco).toHaveBeenLastCalledWith(1234.56)
  })

  it('sem meta, oculta custo máximo de compra e preço para margem-alvo', () => {
    const { unmount } = render(<CalculadoraML />)
    expect(screen.getAllByText(/custo máximo de compra/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/preço para margem-alvo/i).length).toBeGreaterThan(0)
    unmount()

    estado = { ...estadoBase, metaSolicitada: null }
    render(<CalculadoraML />)
    expect(screen.queryByText(/custo máximo de compra/i)).toBeNull()
    expect(screen.queryByText(/preço para margem-alvo/i)).toBeNull()
  })

  it('announces only decision and status changes without nesting a main landmark', () => {
    const view = render(<CalculadoraML />)

    expect(view.container.querySelector('main')).toBeNull()
    expect(view.container.querySelectorAll('[aria-live="polite"]')).toHaveLength(2)
  })

  it('requires an explicit confirmation before accepting manual zero freight', () => {
    const onTaxas = vi.fn()
    render(
      <FormularioCalculadoraML {...propsForm()} taxas={{ ...estadoBase.taxasManuais, frete: 0 }} onTaxas={onTaxas} />,
    )

    fireEvent.click(screen.getByRole('checkbox', { name: /frete realmente zero/i }))

    expect(onTaxas).toHaveBeenCalledWith({ freteRealmenteZero: true })
  })

  it('sincroniza dimensões de produto atualizado e preserva edição parcial subsequente', () => {
    const { onEntrada, ...resto } = propsForm()
    const dimensoesProdutoA = { alturaCm: 10, larguraCm: 20, comprimentoCm: 30, pesoKg: 1 }
    const dimensoesProdutoB = { alturaCm: 40, larguraCm: 50, comprimentoCm: 60, pesoKg: 2 }
    const props = { ...resto, onEntrada, entrada: { ...estadoBase.entrada, dimensoes: dimensoesProdutoA } }
    const view = render(<FormularioCalculadoraML {...props} />)

    view.rerender(<FormularioCalculadoraML {...props} entrada={{ ...props.entrada, dimensoes: dimensoesProdutoB }} />)
    expect(screen.getByLabelText('Altura (cm)')).toHaveValue('40')
    expect(screen.getByLabelText('Largura (cm)')).toHaveValue('50')

    fireEvent.change(screen.getByLabelText('Altura (cm)'), { target: { value: '0' } })
    view.rerender(<FormularioCalculadoraML {...props} entrada={{ ...props.entrada, dimensoes: undefined }} />)
    expect(screen.getByLabelText('Altura (cm)')).toHaveValue('0')
    expect(screen.getByLabelText('Largura (cm)')).toHaveValue('50')
  })

  describe('Task 6 — campos, modalidade, margem viva, central de decisão', () => {
    it('nenhum input é type=number e o foco seleciona o texto inteiro', () => {
      const { container } = render(<CalculadoraML />)
      expect(container.querySelectorAll('input[type=number]')).toHaveLength(0)

      const preco = screen.getByLabelText('Preço de venda (R$)') as HTMLInputElement
      act(() => preco.focus())
      expect(preco.selectionStart).toBe(0)
      expect(preco.selectionEnd).toBe(preco.value.length)
      expect(preco.value.length).toBeGreaterThan(0)
    })

    it('foco + blur sem digitar não chama editarMargem nem editarPreco', async () => {
      const user = userEvent.setup()
      render(<CalculadoraML />)

      await user.click(screen.getByLabelText('Margem (%)'))
      await user.tab()
      await user.click(screen.getByLabelText('Preço de venda (R$)'))
      await user.tab()

      expect(editarMargem).not.toHaveBeenCalled()
      expect(editarPreco).not.toHaveBeenCalled()
    })

    it('digitar na margem chama editarMargem; no preço, editarPreco', () => {
      render(<CalculadoraML />)
      fireEvent.change(screen.getByLabelText('Margem (%)'), { target: { value: '38' } })
      fireEvent.change(screen.getByLabelText('Preço de venda (R$)'), { target: { value: '120,5' } })

      expect(editarMargem).toHaveBeenCalledWith(38)
      expect(editarPreco).toHaveBeenCalledWith(120.5)
      expect(atualizarEntrada).not.toHaveBeenCalledWith(expect.objectContaining({ margemAlvoPct: expect.anything() }))
    })

    it('"Margem (%)" mostra margemExibida com 2 casas; imposto null aparece vazio', () => {
      estado = { ...estadoBase, margemExibida: 23, entrada: { ...estadoBase.entrada, aliquotaImpostoPct: null } }
      render(<CalculadoraML />)
      expect(screen.getByLabelText('Margem (%)')).toHaveValue('23,00')
      expect(screen.getByLabelText('Impostos (%)')).toHaveValue('')
    })

    it('meta não confirmada vira aviso com a meta pedida', () => {
      estado = { ...estadoBase, metaStatus: 'nao_confirmada', metaSolicitada: 38, margemExibida: 37.5 }
      render(<CalculadoraML />)
      expect(screen.getByText(/meta de 38,00% não confirmada/i)).toBeInTheDocument()
    })

    it('produto A → produto B: busca de categoria e rascunhos de medidas são limpos', async () => {
      const user = userEvent.setup()
      const dims = { alturaCm: 10, larguraCm: 20, comprimentoCm: 30, pesoKg: 1 }
      estado = { ...estadoBase, entrada: { ...estadoBase.entrada, categoriaId: 'MLB1', dimensoes: dims } }
      const view = render(<CalculadoraML />)
      await user.type(screen.getByRole('textbox', { name: /buscar categoria mercado livre/i }), 'camisa')
      expect(screen.getByRole('textbox', { name: /buscar categoria mercado livre/i })).toHaveValue('camisa')
      expect(screen.getByLabelText('Altura (cm)')).toHaveValue('10')

      estado = { ...estadoBase, entrada: { ...estadoBase.entrada, categoriaId: undefined, dimensoes: undefined } }
      view.rerender(<CalculadoraML />)

      expect(screen.getByRole('textbox', { name: /buscar categoria mercado livre/i })).toHaveValue('')
      expect(screen.getByLabelText('Altura (cm)')).toHaveValue('0')
    })

    it('mostra a variação usada, o preço "de" riscado só com promoção e a categoria com nome + ID', () => {
      const anuncio = { publicado: true, itemId: 'MLB9', preco: 100, precoOriginal: 130, categoriaId: 'MLB1', categoriaNome: 'Camisetas' } as HookState['anuncio']
      estado = {
        ...estadoBase, anuncio, categoriaNome: 'Camisetas', variacaoUsada: { codigo: 'V-01', cor: 'Azul' },
        entrada: { ...estadoBase.entrada, categoriaId: 'MLB1' },
      }
      const { container, unmount } = render(<CalculadoraML />)
      expect(screen.getByText(/preço\/medidas da variação V-01 \(Azul\)/i)).toBeInTheDocument()
      expect(container.querySelector('s')).toHaveTextContent('R$ 130,00')
      expect(screen.getByText(/Camisetas · MLB1/)).toBeInTheDocument()
      unmount()

      estado = { ...estado, anuncio: { ...anuncio!, precoOriginal: 100 } }
      const igual = render(<CalculadoraML />)
      expect(igual.container.querySelector('s')).toBeNull()
    })

    it('avisos do produto saem com role=status', () => {
      estado = { ...estadoBase, avisosProduto: ['Imposto desconhecido: origem do produto não definida.'] }
      render(<CalculadoraML />)
      expect(screen.getByRole('status', { name: /avisos do produto/i })).toHaveTextContent(/imposto desconhecido/i)
    })

    it('modalidade: toggle sempre editável; publicado mostra "Clássico · do anúncio"', async () => {
      const user = userEvent.setup()
      estado = { ...estadoBase, modalidadeDoAnuncio: 'classico' }
      render(<CalculadoraML />)
      const classico = screen.getByRole('button', { name: /clássico · do anúncio/i })
      const premium = screen.getByRole('button', { name: /^premium$/i })
      expect(classico).toHaveAttribute('aria-pressed', 'true')

      await user.click(premium)
      expect(premium).toHaveAttribute('aria-pressed', 'true')
      expect(classico).toHaveAttribute('aria-pressed', 'false')
    })

    it('a alternância de visão no mobile não altera a modalidade ativa', async () => {
      const user = userEvent.setup()
      render(<CalculadoraML />)
      await user.click(screen.getByRole('button', { name: /ver premium/i }))
      await user.click(screen.getByRole('tab', { name: /premium/i }))

      expect(screen.getByRole('button', { name: /^clássico$/i })).toHaveAttribute('aria-pressed', 'true')
    })

    it('trocar a modalidade no form chama onModalidade', async () => {
      const user = userEvent.setup()
      const props = propsForm()
      render(<FormularioCalculadoraML {...props} />)
      await user.click(screen.getByRole('button', { name: /^premium$/i }))
      expect(props.onModalidade).toHaveBeenCalledWith('premium')
    })

    it('nenhum texto manda validar na API nem cita meta de 0%', () => {
      const { container } = render(<CalculadoraML />)
      expect(container.textContent).not.toMatch(/valide na api|validar na api|meta reversa|atinge a meta de 0\s?%/i)
    })
  })
})
