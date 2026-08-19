import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tarifa } from '@/lib/tarifa'
import type { ProdutoEstoqueResumo, VariacaoComSaldo } from '@/lib/produtos-saldo'

const { calcularTarifaMock, fetchProdutosMock, fetchVariacoesMock } = vi.hoisted(() => ({
  calcularTarifaMock: vi.fn(),
  fetchProdutosMock: vi.fn(),
  fetchVariacoesMock: vi.fn(),
}))

vi.mock('@/lib/tarifa', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tarifa')>(),
  calcularTarifaML: calcularTarifaMock,
}))
vi.mock('@/lib/produtos-saldo', () => ({
  fetchProdutosEstoqueResumo: fetchProdutosMock,
  fetchVariacoesProduto: fetchVariacoesMock,
}))

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

const dimensoes = { alturaCm: 10, larguraCm: 20, comprimentoCm: 30, pesoKg: 1 }

const produtoResumo: ProdutoEstoqueResumo = {
  codigoPai: 'PAI-1',
  nomePai: 'Produto de teste',
  descricaoPai: null,
  saldoTotal: 3,
  qtdSkus: 2,
  capaStoragePath: null,
  capaMlPictureId: null,
  fornecedor: null,
  unidade: null,
  origem: 'manual',
  mlItemId: null,
  criadoEm: '2026-08-01T00:00:00.000Z',
  gtins: [],
  codigos: ['SKU-1', 'SKU-2'],
  cores: [],
  nomes: [],
  skuUnico: 'SKU-2',
}

const variacao = (codigo: string, valores: Partial<VariacaoComSaldo> = {}): VariacaoComSaldo => ({
  codigo,
  nome: null,
  cor: null,
  gtin: null,
  estoque: 1,
  custo: null,
  preco: 0,
  pesoGramas: null,
  alturaCm: null,
  larguraCm: null,
  comprimentoCm: null,
  imagemPath: null,
  mlPictureId: null,
  mlItemId: null,
  ...valores,
})

describe('useCalculadoraML', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    calcularTarifaMock.mockReset()
    fetchProdutosMock.mockReset()
    fetchVariacoesMock.mockReset()
    fetchProdutosMock.mockResolvedValue({ kpis: {}, produtos: [] })
  })

  afterEach(() => vi.useRealTimers())

  it('usa a cotação oficial da categoria para as duas modalidades', async () => {
    calcularTarifaMock.mockResolvedValue(tarifaOficial())
    const { result } = renderHook(
      () => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1', dimensoes }),
      { wrapper },
    )

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

  it('edição das taxas manuais preserva a cotação oficial aplicada', async () => {
    calcularTarifaMock.mockResolvedValue(tarifaOficial())
    const { result } = renderHook(
      () => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1', dimensoes }),
      { wrapper },
    )

    await avancarCotacao()
    act(() => result.current.atualizarTaxasManuais({ percentualComissaoPct: 12 }))

    expect(result.current.cotacao.origem).toBe('official')
    expect(result.current.statusCotacao).toBe('official')
  })

  it('valida o preço projetado na API e publica a cotação da meta', async () => {
    calcularTarifaMock.mockResolvedValue(tarifaOficial(21))
    const { result } = renderHook(
      () => useCalculadoraML({ precoVenda: 100, custoProduto: 50, margemAlvoPct: 20, categoriaId: 'MLB1', dimensoes }),
      { wrapper },
    )

    await avancarCotacao()
    const tarifa = await act(async () => result.current.validarNaApi())

    expect(tarifa?.premium.percentual).toBe(21)
    expect(result.current.cotacaoMeta?.premium.percentual).toBe(21)
    expect(result.current.validacaoMeta).toMatchObject({
      modalidade: 'classico',
      proveniencia: 'official',
    })
    const [precoValidado, categoriaValidada, dimensoesValidadas, aliquotaValidada] =
      calcularTarifaMock.mock.lastCall ?? []
    expect(precoValidado).toBeCloseTo(106.25)
    expect(categoriaValidada).toBe('MLB1')
    expect(dimensoesValidadas).toEqual({
      alturaCm: 10, larguraCm: 20, comprimentoCm: 30, pesoGramas: 1000,
    })
    expect(aliquotaValidada).toBe(0)
  })

  it('descarta validação de meta antiga após uma edição e nova validação', async () => {
    let resolverAntigo: ((tarifa: Tarifa | null) => void) | undefined
    calcularTarifaMock
      .mockResolvedValueOnce(tarifaOficial())
      .mockImplementationOnce(() => new Promise<Tarifa | null>((resolve) => { resolverAntigo = resolve }))
      .mockResolvedValueOnce(tarifaOficial(21))
    const { result } = renderHook(
      () => useCalculadoraML({ precoVenda: 100, custoProduto: 50, margemAlvoPct: 20, categoriaId: 'MLB1', dimensoes }),
      { wrapper },
    )

    await avancarCotacao()
    let primeira: Promise<Tarifa | null>
    act(() => { primeira = result.current.validarNaApi() })
    act(() => result.current.atualizarEntrada({ custoProduto: 60 }))
    const segunda = await act(async () => result.current.validarNaApi())
    expect(segunda?.premium.percentual).toBe(21)
    expect(result.current.cotacaoMeta?.premium.percentual).toBe(21)

    await act(async () => { resolverAntigo?.(tarifaOficial(16)) })

    expect(await primeira!).toBeNull()
    expect(result.current.cotacaoMeta?.premium.percentual).toBe(21)
  })

  it('descarta validação de meta pendente quando o produto é limpo', async () => {
    let resolverAntigo: ((tarifa: Tarifa | null) => void) | undefined
    calcularTarifaMock
      .mockResolvedValueOnce(tarifaOficial())
      .mockImplementationOnce(
        () => new Promise<Tarifa | null>((resolve) => { resolverAntigo = resolve }),
      )
    const { result } = renderHook(
      () => useCalculadoraML({ precoVenda: 100, custoProduto: 50, margemAlvoPct: 20, categoriaId: 'MLB1', dimensoes }),
      { wrapper },
    )

    await avancarCotacao()
    act(() => { void result.current.validarNaApi() })
    act(() => { void result.current.selecionarProduto(null) })
    await act(async () => { resolverAntigo?.(tarifaOficial(16)) })

    expect(result.current.cotacaoMeta).toBeNull()
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

  it('preserva uma cotação oficial ao editar custo fora da chave efetiva', async () => {
    calcularTarifaMock.mockResolvedValue(tarifaOficial())
    const { result } = renderHook(
      () => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1', dimensoes }),
      { wrapper },
    )

    await avancarCotacao()
    act(() => result.current.atualizarEntrada({ custoProduto: 55 }))

    expect(result.current.cotacao.origem).toBe('official')
    expect(result.current.statusCotacao).toBe('official')
    expect(calcularTarifaMock).toHaveBeenCalledTimes(1)
  })

  it('combina comissão oficial e frete manual confirmado como cotação parcial sem dimensões', async () => {
    calcularTarifaMock.mockResolvedValue(tarifaOficial())
    const { result } = renderHook(
      () => useCalculadoraML({
        precoVenda: 100,
        categoriaId: 'MLB1',
        taxasManuais: { percentualComissaoPct: 12, frete: 9 },
      }),
      { wrapper },
    )

    await avancarCotacao()

    expect(result.current.cotacao.origem).toBe('official')
    expect(result.current.cotacao.classico).toMatchObject({ frete: 9, proveniencia: 'partial' })
    expect(result.current.resultado.proveniencia).toBe('partial')
  })

  it('treats manual zero freight as unconfirmed until it is explicitly confirmed', () => {
    const { result } = renderHook(
      () => useCalculadoraML({
        precoVenda: 100,
        taxasManuais: { percentualComissaoPct: 12, frete: 0 },
      }),
      { wrapper },
    )

    expect(result.current.resultado.veredito.tipo).toBe('Dados insuficientes')
    act(() => result.current.atualizarTaxasManuais({ freteRealmenteZero: true }))
    expect(result.current.resultado.veredito.tipo).toBe('Comprar')
  })

  it('prefills from the unique SKU variation instead of invented summary fields', async () => {
    fetchVariacoesMock.mockResolvedValue([
      variacao('SKU-1', { custo: 11, preco: 21, pesoGramas: 500, alturaCm: 5, larguraCm: 6, comprimentoCm: 7 }),
      variacao('SKU-2', { custo: 31, preco: 51, pesoGramas: 1500, alturaCm: 15, larguraCm: 16, comprimentoCm: 17 }),
    ])
    const { result } = renderHook(() => useCalculadoraML(), { wrapper })

    await act(async () => { await result.current.selecionarProduto(produtoResumo) })

    expect(result.current.entrada).toMatchObject({
      custoProduto: 31,
      precoVenda: 51,
      dimensoes: { alturaCm: 15, larguraCm: 16, comprimentoCm: 17, pesoKg: 1.5 },
    })
  })

  it('uses the first variation with usable data when the product has no unique SKU', async () => {
    fetchVariacoesMock.mockResolvedValue([
      variacao('SKU-1'),
      variacao('SKU-2', { custo: 31, preco: 51, pesoGramas: 1500, alturaCm: 15, larguraCm: 16, comprimentoCm: 17 }),
    ])
    const { result } = renderHook(() => useCalculadoraML(), { wrapper })

    await act(async () => { await result.current.selecionarProduto({ ...produtoResumo, skuUnico: null }) })

    expect(result.current.entrada).toMatchObject({
      custoProduto: 31,
      precoVenda: 51,
      dimensoes: { alturaCm: 15, larguraCm: 16, comprimentoCm: 17, pesoKg: 1.5 },
    })
  })

  it('only confirms projected-price validation when the returned tariff reaches the selected target margin', async () => {
    calcularTarifaMock
      .mockResolvedValueOnce(tarifaOficial())
      .mockResolvedValueOnce({
        ...tarifaOficial(),
        premium: { percentual: 16, fixa: 6, comissao: 80, imposto: 0, recebe: 26.25 },
      })
    const { result } = renderHook(
      () => useCalculadoraML({
        precoVenda: 100,
        custoProduto: 50,
        margemAlvoPct: 20,
        categoriaId: 'MLB1',
        dimensoes,
        modalidadeParaDecisao: 'premium',
      }),
      { wrapper },
    )

    await avancarCotacao()
    const tarifa = await act(async () => result.current.validarNaApi())

    expect(tarifa).toBeNull()
    expect(result.current.cotacaoMeta).toBeNull()
    expect(result.current.erroMeta).toMatch(/não confirmou a margem-alvo/i)
  })
})
