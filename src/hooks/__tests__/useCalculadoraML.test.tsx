import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tarifa } from '@/lib/tarifa'
import type { ProdutoEstoqueResumo, VariacaoComSaldo } from '@/lib/produtos-saldo'

const { calcularTarifaMock, fetchProdutosMock, fetchVariacoesMock, fetchAnuncioMock, aliquotasState } = vi.hoisted(() => ({
  calcularTarifaMock: vi.fn(),
  fetchProdutosMock: vi.fn(),
  fetchVariacoesMock: vi.fn(),
  fetchAnuncioMock: vi.fn(),
  aliquotasState: { data: undefined as { nacional: number; importado: number; confirmada: boolean } | undefined },
}))

vi.mock('@/lib/tarifa', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/tarifa')>(),
  calcularTarifaML: calcularTarifaMock,
}))
vi.mock('@/lib/produtos-saldo', () => ({
  fetchProdutosEstoqueResumo: fetchProdutosMock,
  fetchVariacoesProduto: fetchVariacoesMock,
}))
vi.mock('@/lib/anuncio-calculadora', () => ({ fetchAnuncioCalculadora: fetchAnuncioMock }))
vi.mock('@/hooks/useConfiguracoes', () => ({ useAliquotas: () => aliquotasState }))

const { useCalculadoraML, cotacaoCalculadora, reducerCalculadora, estadoInicialCalculadora } =
  await import('../useCalculadoraML')
type AnuncioCalculadora = import('@/lib/anuncio-calculadora').AnuncioCalculadora

const tarifaOficial = (comissao = 16): Tarifa => ({
  classico: { percentual: comissao - 5, fixa: 6, comissao: 17, imposto: 0, recebe: 83 },
  premium: { percentual: comissao, fixa: 6, comissao: 22, imposto: 0, recebe: 78 },
  frete: 12,
  proveniencia: 'official',
})

const tarifaNaoOficial = (
  proveniencia: 'partial' | 'estimated',
  motivo_proveniencia: string,
): Tarifa => ({ ...tarifaOficial(), frete: 0, proveniencia, motivo_proveniencia })

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
  temTamanho: false,
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
  kits: [],
  tamanho: null,
  ...valores,
})

const naoPublicado = (v: Partial<AnuncioCalculadora> = {}): AnuncioCalculadora => ({
  publicado: false, itemId: null, preco: null, precoOriginal: null, fontePreco: null,
  salePriceFalhou: false, modalidade: null, categoriaId: 'MLB1000', categoriaNome: 'Cadastro',
  categoriaFonte: 'cadastro', statusAnuncio: null, ...v,
})
const publicado = (v: Partial<AnuncioCalculadora> = {}): AnuncioCalculadora => ({
  publicado: true, itemId: 'MLB123', preco: 20, precoOriginal: null, fontePreco: 'sale_price',
  salePriceFalhou: false, modalidade: 'classico', categoriaId: 'MLB200339', categoriaNome: 'Água micelar',
  categoriaFonte: 'item', statusAnuncio: 'active', ...v,
})

function adiado<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useCalculadoraML', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    calcularTarifaMock.mockReset()
    fetchProdutosMock.mockReset()
    fetchVariacoesMock.mockReset()
    fetchAnuncioMock.mockReset()
    fetchProdutosMock.mockResolvedValue({ kpis: {}, produtos: [] })
    fetchAnuncioMock.mockResolvedValue(naoPublicado())
    aliquotasState.data = { nacional: 8, importado: 16, confirmada: true }
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
    calcularTarifaMock.mockResolvedValue(
      tarifaNaoOficial('partial', 'o frete foi calculado com um pacote padrão'),
    )
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
    expect(result.current.resultado.veredito.tipo).toBe('Margem atual')
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

  // `fetchVariacoesProduto` entrega em ordem alfabética de COR (o card e a entrada de
  // mercadoria leem a lista pelo nome da cor). O prefill alimenta custo, preço e dimensões
  // da cotação: não pode seguir a ordem de exibição, senão a margem calculada muda quando
  // alguém renomeia uma cor. Continua sendo a de menor código.
  it('ignores the display order (by colour) and prefills from the lowest code', async () => {
    fetchVariacoesMock.mockResolvedValue([
      variacao('SKU-2', { cor: 'Amarelo', custo: 31, preco: 51, pesoGramas: 1500, alturaCm: 15, larguraCm: 16, comprimentoCm: 17 }),
      variacao('SKU-1', { cor: 'Vermelho', custo: 11, preco: 21, pesoGramas: 500, alturaCm: 5, larguraCm: 6, comprimentoCm: 7 }),
    ])
    const { result } = renderHook(() => useCalculadoraML(), { wrapper })

    await act(async () => { await result.current.selecionarProduto({ ...produtoResumo, skuUnico: null }) })

    expect(result.current.entrada).toMatchObject({
      custoProduto: 11,
      precoVenda: 21,
      dimensoes: { alturaCm: 5, larguraCm: 6, comprimentoCm: 7, pesoKg: 0.5 },
    })
  })

  describe('frete desconhecido (B1)', () => {
    it('tarifa official usa o frete da tarifa com selo oficial', async () => {
      calcularTarifaMock.mockResolvedValue(tarifaOficial())
      const { result } = renderHook(
        () => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1', dimensoes }),
        { wrapper },
      )

      await avancarCotacao()

      expect(result.current.cotacao.classico).toMatchObject({ frete: 12, proveniencia: 'official' })
      expect(result.current.statusCotacao).toBe('official')
      expect(result.current.aviso).toBeNull()
    })

    it.each([
      ['partial', 'medida abaixo do piso de 0,2 cm'],
      ['estimated', 'o Mercado Livre recusou o cálculo de frete (HTTP 500)'],
    ] as const)('tarifa %s sem frete manual deixa o frete desconhecido', async (proveniencia, motivo) => {
      calcularTarifaMock.mockResolvedValue(tarifaNaoOficial(proveniencia, motivo))
      const { result } = renderHook(
        () => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1', dimensoes, taxasManuais: { frete: 0 } }),
        { wrapper },
      )

      await avancarCotacao()

      expect(result.current.cotacao.classico.frete).toBeNull()
      expect('premium' in result.current.cotacao && result.current.cotacao.premium.frete).toBeNull()
      expect(result.current.cotacao.classico.proveniencia).toBe(proveniencia)
      expect(result.current.resultado.proveniencia).toBe(proveniencia)
      expect(result.current.statusCotacao).not.toBe('official')
      expect(result.current.aviso).toContain(motivo)
    })

    it('tarifa partial com frete manual confirmado usa o frete manual como parcial', async () => {
      calcularTarifaMock.mockResolvedValue(tarifaNaoOficial('partial', 'medida abaixo do piso'))
      const { result } = renderHook(
        () => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1', dimensoes, taxasManuais: { frete: 9 } }),
        { wrapper },
      )

      await avancarCotacao()

      expect(result.current.cotacao.classico).toMatchObject({ frete: 9, proveniencia: 'partial' })
      expect(result.current.statusCotacao).toBe('partial')
    })

    it.each([
      ['falha de frete', 'o Mercado Livre não respondeu o frete (timeout)'],
      ['comissão ausente', 'o Mercado Livre respondeu sem `sale_fee_amount` para o Clássico — a comissão não veio'],
    ])('tarifa estimated (%s) com frete manual confirmado nunca é promovida', async (_caso, motivo) => {
      calcularTarifaMock.mockResolvedValue({ ...tarifaNaoOficial('estimated', motivo), frete: 12 })
      const { result } = renderHook(
        () => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1', dimensoes, taxasManuais: { frete: 9 } }),
        { wrapper },
      )

      await avancarCotacao()

      expect(result.current.cotacao.classico).toMatchObject({ frete: 9, proveniencia: 'estimated' })
      expect('premium' in result.current.cotacao && result.current.cotacao.premium.proveniencia).toBe('estimated')
      expect(result.current.resultado.proveniencia).toBe('estimated')
      expect(result.current.statusCotacao).toBe('estimated')
    })

    it('aviso acompanha o frete manual confirmado ou zerado depois da cotação', async () => {
      calcularTarifaMock.mockResolvedValue(tarifaNaoOficial('partial', 'medida abaixo do piso'))
      const { result } = renderHook(
        () => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1', dimensoes, taxasManuais: { frete: 0 } }),
        { wrapper },
      )

      await avancarCotacao()
      expect(result.current.aviso).toMatch(/confirme o frete manual/i)

      act(() => result.current.atualizarTaxasManuais({ frete: 9 }))
      expect(result.current.aviso).toMatch(/frete manual confirmado/i)
      expect(result.current.aviso).toContain('medida abaixo do piso')
      expect(result.current.statusCotacao).toBe('partial')

      act(() => result.current.atualizarTaxasManuais({ frete: 0 }))
      expect(result.current.aviso).toMatch(/confirme o frete manual/i)
    })

    it('tarifa sem proveniência (resposta antiga) falha fechado como estimated', async () => {
      const { proveniencia: _p, ...semCampo } = tarifaOficial()
      calcularTarifaMock.mockResolvedValue(semCampo)
      const { result } = renderHook(
        () => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1', dimensoes }),
        { wrapper },
      )

      await avancarCotacao()

      expect(result.current.cotacao.classico).toMatchObject({ frete: null, proveniencia: 'estimated' })
      expect(result.current.statusCotacao).toBe('estimated')
    })
  })

  describe('cotacaoCalculadora', () => {
    const taxas = { percentualComissaoPct: 12, taxaFixa: 0, frete: 9, freteRealmenteZero: false }

    it('official preserva comissão e frete da tarifa', () => {
      const c = cotacaoCalculadora(tarifaOficial(), taxas)
      expect(c.origem).toBe('official')
      expect(c.premium).toMatchObject({ comissaoTotal: 22, frete: 12, proveniencia: 'official' })
    })

    it('frete manual zero só conta quando confirmado', () => {
      const tarifa = tarifaNaoOficial('partial', 'x')
      expect(cotacaoCalculadora(tarifa, { ...taxas, frete: 0 }).classico.frete).toBeNull()
      expect(cotacaoCalculadora(tarifa, { ...taxas, frete: 0, freteRealmenteZero: true }).classico.frete).toBe(0)
    })
  })

  describe('produto cadastrado → prefill atômico (B2)', () => {
    const dimA = { pesoGramas: 500, alturaCm: 5, larguraCm: 6, comprimentoCm: 7 }
    const produtoA: ProdutoEstoqueResumo = { ...produtoResumo, codigoPai: 'PAI-A', origem: 'nacional', skuUnico: 'A-1' }
    const produtoB: ProdutoEstoqueResumo = { ...produtoResumo, codigoPai: 'PAI-B', origem: '', skuUnico: 'B-1' }
    const variacoesA = [variacao('A-1', { custo: 10, preco: 30, mlItemId: 'MLB123', cor: 'Azul', ...dimA })]
    const variacoesB = [variacao('B-1', { custo: null, preco: 15 })]

    function render() {
      return renderHook(() => useCalculadoraML(), { wrapper })
    }
    async function selecionar(result: ReturnType<typeof render>['result'], produto: ProdutoEstoqueResumo | null) {
      await act(async () => { await result.current.selecionarProduto(produto) })
    }

    it('produto publicado: preço vivo, categoria e modalidade do anúncio, imposto pela origem', async () => {
      fetchVariacoesMock.mockResolvedValue(variacoesA)
      fetchAnuncioMock.mockResolvedValue(publicado())
      const { result } = render()

      await selecionar(result, produtoA)

      expect(result.current.entrada).toMatchObject({
        precoVenda: 20, categoriaId: 'MLB200339', custoProduto: 10, aliquotaImpostoPct: 8,
        dimensoes: { alturaCm: 5, larguraCm: 6, comprimentoCm: 7, pesoKg: 0.5 },
      })
      expect(result.current.modalidadeAtiva).toBe('classico')
      expect(result.current.modalidadeDoAnuncio).toBe('classico')
      expect(result.current.categoriaNome).toBe('Água micelar')
      expect(result.current.variacaoUsada).toEqual({ codigo: 'A-1', cor: 'Azul' })
      expect(result.current.anuncio?.preco).toBe(20)
    })

    it('anúncio premium define a modalidade ativa e a decisão do motor', async () => {
      fetchVariacoesMock.mockResolvedValue(variacoesA)
      fetchAnuncioMock.mockResolvedValue(publicado({ modalidade: 'premium' }))
      const { result } = render()

      await selecionar(result, produtoA)

      expect(result.current.modalidadeAtiva).toBe('premium')
      expect(result.current.entrada.modalidadeParaDecisao).toBe('premium')
      act(() => result.current.setModalidadeAtiva('classico'))
      expect(result.current.modalidadeAtiva).toBe('classico')
      expect(result.current.modalidadeDoAnuncio).toBe('premium')
      expect(result.current.entrada.modalidadeParaDecisao).toBe('classico')
    })

    it('lê o anúncio só depois de escolher a variação, pelo item dela', async () => {
      const variacoes = adiado<VariacaoComSaldo[]>()
      fetchVariacoesMock.mockReturnValue(variacoes.promise)
      fetchAnuncioMock.mockResolvedValue(publicado())
      const { result } = render()

      act(() => { void result.current.selecionarProduto(produtoA) })
      await act(async () => { await Promise.resolve() })
      expect(fetchAnuncioMock).not.toHaveBeenCalled()
      await act(async () => { variacoes.resolve(variacoesA) })

      expect(fetchAnuncioMock).toHaveBeenCalledWith('PAI-A', 'MLB123')
    })

    it('troca A → B limpa o que B não tem: medidas, custo e imposto (com aviso de origem)', async () => {
      fetchVariacoesMock.mockResolvedValueOnce(variacoesA).mockResolvedValueOnce(variacoesB)
      fetchAnuncioMock.mockResolvedValueOnce(publicado()).mockResolvedValueOnce(naoPublicado())
      const { result } = render()

      await selecionar(result, produtoA)
      await selecionar(result, produtoB)

      expect(result.current.entrada.dimensoes).toBeUndefined()
      expect(result.current.entrada.aliquotaImpostoPct).toBeNull()
      expect(result.current.entrada.custoProduto).toBe(0)
      expect(result.current.entrada.precoVenda).toBe(15)
      expect(result.current.entrada.categoriaId).toBe('MLB1000')
      expect(result.current.modalidadeDoAnuncio).toBeNull()
      expect(result.current.avisosProduto.join(' ')).toMatch(/origem/i)
      expect(result.current.avisosProduto.join(' ')).not.toMatch(/preço no ar/i)
    })

    it('alíquotas carregando → null; chegam e preenchem; editado à mão não é sobrescrito', async () => {
      aliquotasState.data = undefined
      fetchVariacoesMock.mockResolvedValue(variacoesA)
      fetchAnuncioMock.mockResolvedValue(publicado())
      const { result, rerender } = render()

      await selecionar(result, produtoA)
      expect(result.current.entrada.aliquotaImpostoPct).toBeNull()

      aliquotasState.data = { nacional: 8, importado: 16, confirmada: true }
      rerender()
      expect(result.current.entrada.aliquotaImpostoPct).toBe(8)

      act(() => result.current.atualizarEntrada({ aliquotaImpostoPct: 5 }))
      aliquotasState.data = { nacional: 9, importado: 16, confirmada: true }
      rerender()
      expect(result.current.entrada.aliquotaImpostoPct).toBe(5)
    })

    it('alíquotas sem confirmação deixam o imposto desconhecido com aviso', async () => {
      aliquotasState.data = { nacional: 8, importado: 16, confirmada: false }
      fetchVariacoesMock.mockResolvedValue(variacoesA)
      fetchAnuncioMock.mockResolvedValue(publicado())
      const { result } = render()

      await selecionar(result, produtoA)

      expect(result.current.entrada.aliquotaImpostoPct).toBeNull()
      expect(result.current.avisosProduto.join(' ')).toMatch(/confirm/i)
    })

    it.each([
      ['a leitura rejeita (HTTP)', () => fetchAnuncioMock.mockRejectedValue(new Error('HTTP 500'))],
      ['o preço volta null', () => fetchAnuncioMock.mockResolvedValue(publicado({ preco: null, categoriaFonte: 'cadastro', motivo: 'sem_conexao' }))],
    ])('quando %s, usa o preço do cadastro com aviso', async (_caso, preparar) => {
      fetchVariacoesMock.mockResolvedValue(variacoesA)
      preparar()
      const { result } = render()

      await selecionar(result, produtoA)

      expect(result.current.entrada.precoVenda).toBe(30)
      expect(result.current.avisosProduto.join(' ')).toMatch(/não foi possível ler o preço no ar/i)
    })

    it('sale_price falhou → aviso de promoção', async () => {
      fetchVariacoesMock.mockResolvedValue(variacoesA)
      fetchAnuncioMock.mockResolvedValue(publicado({ salePriceFalhou: true, fontePreco: 'items' }))
      const { result } = render()

      await selecionar(result, produtoA)

      expect(result.current.entrada.precoVenda).toBe(20)
      expect(result.current.avisosProduto.join(' ')).toMatch(/promoção/i)
    })

    it('categoria do cadastro em produto publicado gera aviso', async () => {
      fetchVariacoesMock.mockResolvedValue(variacoesA)
      fetchAnuncioMock.mockResolvedValue(publicado({ categoriaFonte: 'cadastro', categoriaId: 'MLB1000' }))
      const { result } = render()

      await selecionar(result, produtoA)

      expect(result.current.entrada.categoriaId).toBe('MLB1000')
      expect(result.current.avisosProduto.join(' ')).toMatch(/categoria do cadastro — o anúncio não informou/i)
    })

    it('anúncio pausado no ML gera aviso', async () => {
      fetchVariacoesMock.mockResolvedValue(variacoesA)
      fetchAnuncioMock.mockResolvedValue(publicado({ statusAnuncio: 'paused' }))
      const { result } = render()

      await selecionar(result, produtoA)

      expect(result.current.avisosProduto.join(' ')).toMatch(/anúncio pausado no ML/i)
    })

    it('lista de variações vazia limpa os campos do produto e avisa', async () => {
      fetchVariacoesMock.mockResolvedValueOnce(variacoesA).mockResolvedValueOnce([])
      fetchAnuncioMock.mockResolvedValue(publicado())
      const { result } = render()

      await selecionar(result, produtoA)
      await selecionar(result, produtoB)

      expect(fetchAnuncioMock).toHaveBeenCalledTimes(1)
      expect(result.current.entrada).toMatchObject({ custoProduto: 0, precoVenda: 0, aliquotaImpostoPct: null })
      expect(result.current.entrada.categoriaId).toBeUndefined()
      expect(result.current.entrada.dimensoes).toBeUndefined()
      expect(result.current.avisosProduto.join(' ')).toMatch(/variaç/i)
    })

    it('resposta de A chegando depois de selecionar B é ignorada', async () => {
      const variacoesAtrasadas = adiado<VariacaoComSaldo[]>()
      fetchVariacoesMock.mockReturnValueOnce(variacoesAtrasadas.promise).mockResolvedValueOnce(variacoesB)
      fetchAnuncioMock.mockResolvedValue(naoPublicado())
      const { result } = render()

      act(() => { void result.current.selecionarProduto(produtoA) })
      await selecionar(result, produtoB)
      await act(async () => { variacoesAtrasadas.resolve(variacoesA) })

      expect(result.current.produtoSelecionado?.codigoPai).toBe('PAI-B')
      expect(result.current.entrada.precoVenda).toBe(15)
      expect(fetchAnuncioMock).toHaveBeenCalledTimes(1)
    })

    it('alíquotas chegando durante o prefill não descartam o prefill', async () => {
      aliquotasState.data = undefined
      const anuncio = adiado<AnuncioCalculadora>()
      fetchVariacoesMock.mockResolvedValue(variacoesA)
      fetchAnuncioMock.mockReturnValue(anuncio.promise)
      const { result, rerender } = render()

      act(() => { void result.current.selecionarProduto(produtoA) })
      await act(async () => { await Promise.resolve() })
      aliquotasState.data = { nacional: 8, importado: 16, confirmada: true }
      rerender()
      await act(async () => { anuncio.resolve(publicado()) })

      expect(result.current.entrada).toMatchObject({ precoVenda: 20, categoriaId: 'MLB200339', aliquotaImpostoPct: 8 })
    })

    it('custo digitado entre a RPC e a edge é mantido; o resto do prefill conclui', async () => {
      const anuncio = adiado<AnuncioCalculadora>()
      fetchVariacoesMock.mockResolvedValue(variacoesA)
      fetchAnuncioMock.mockReturnValue(anuncio.promise)
      const { result } = render()

      act(() => { void result.current.selecionarProduto(produtoA) })
      await act(async () => { await Promise.resolve() })
      expect(fetchAnuncioMock).toHaveBeenCalled()
      act(() => result.current.atualizarEntrada({ custoProduto: 99 }))
      await act(async () => { anuncio.resolve(publicado()) })

      expect(result.current.entrada).toMatchObject({ custoProduto: 99, precoVenda: 20, categoriaId: 'MLB200339' })
    })

    it('"Produto avulso" limpa os campos do produto e a modalidade do anúncio', async () => {
      fetchVariacoesMock.mockResolvedValue(variacoesA)
      fetchAnuncioMock.mockResolvedValue(publicado({ modalidade: 'premium' }))
      const { result } = render()

      await selecionar(result, produtoA)
      await selecionar(result, null)

      expect(result.current.entrada).toMatchObject({ custoProduto: 0, precoVenda: 0, aliquotaImpostoPct: null })
      expect(result.current.entrada.categoriaId).toBeUndefined()
      expect(result.current.entrada.dimensoes).toBeUndefined()
      expect(result.current.modalidadeDoAnuncio).toBeNull()
      expect(result.current.anuncio).toBeNull()
      expect(result.current.avisosProduto).toEqual([])
    })
  })

  describe('validade da cotação pela chave', () => {
    it('editar custo, imposto ou rebate com a cotação em voo ainda publica a resposta', async () => {
      const tarifa = adiado<Tarifa | null>()
      calcularTarifaMock.mockReturnValue(tarifa.promise)
      const { result } = renderHook(
        () => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1', dimensoes }),
        { wrapper },
      )

      await avancarCotacao()
      expect(result.current.statusCotacao).toBe('loading')
      act(() => result.current.atualizarEntrada({ custoProduto: 40 }))
      act(() => result.current.atualizarEntrada({ aliquotaImpostoPct: 10 }))
      act(() => result.current.atualizarEntrada({ rebate: 2 }))
      await act(async () => { tarifa.resolve(tarifaOficial()) })
      await avancarCotacao()

      expect(calcularTarifaMock).toHaveBeenCalledTimes(1)
      expect(result.current.statusCotacao).toBe('official')
      expect(result.current.cotacao.origem).toBe('official')
    })

    it('cotação antiga chegando depois de editar o preço é ignorada', async () => {
      const antiga = adiado<Tarifa | null>()
      const nova = adiado<Tarifa | null>()
      calcularTarifaMock.mockReturnValueOnce(antiga.promise).mockReturnValueOnce(nova.promise)
      const { result } = renderHook(() => useCalculadoraML({ precoVenda: 100, categoriaId: 'MLB1' }), { wrapper })

      await avancarCotacao()
      act(() => result.current.atualizarEntrada({ precoVenda: 120 }))
      await act(async () => { antiga.resolve(tarifaOficial()) })

      expect(result.current.statusCotacao).toBe('loading')
      expect(result.current.cotacao.origem).toBe('manual')
    })
  })

  describe('preço ⇄ margem (I3)', () => {
    // Tarifa que acompanha o preço: comissão percentual (sem fixa) e frete 10.
    const tarifaNoPreco = (p: number, pct = 11, proveniencia: Tarifa['proveniencia'] = 'official'): Tarifa => ({
      classico: { percentual: pct, fixa: 0, comissao: Math.round(p * pct) / 100, imposto: 0, recebe: 0 },
      premium: { percentual: pct + 5, fixa: 0, comissao: Math.round(p * (pct + 5)) / 100, imposto: 0, recebe: 0 },
      frete: 10,
      proveniencia,
    })
    const base = { precoVenda: 100, custoProduto: 50, aliquotaImpostoPct: 0, categoriaId: 'MLB1', dimensoes }
    const avancarSolver = async () => {
      await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    }

    it('editarPreco: margem exibida é a efetiva no novo preço', async () => {
      calcularTarifaMock.mockImplementation(async (p: number) => tarifaNoPreco(p))
      const { result } = renderHook(() => useCalculadoraML(base), { wrapper })
      await avancarCotacao()

      act(() => result.current.editarPreco(25))
      await avancarCotacao()

      expect(result.current.entrada.precoVenda).toBe(25)
      expect(result.current.margemEfetiva).toBe(result.current.resultado.modalidades.classico!.margemPctExata)
      expect(result.current.margemExibida).toBe(result.current.margemEfetiva)
      expect(result.current.ultimoEditado).toBe('preco')
    })

    it('editarMargem: debounce, meta exibida enquanto calcula, publica preço + cotação e não recota', async () => {
      calcularTarifaMock.mockImplementation(async (p: number) => tarifaNoPreco(p))
      const { result } = renderHook(() => useCalculadoraML(base), { wrapper })
      await avancarCotacao()
      expect(calcularTarifaMock).toHaveBeenCalledTimes(1)

      act(() => result.current.editarMargem(38))
      expect(result.current.metaStatus).toBe('calculando')
      expect(result.current.margemExibida).toBe(38)
      expect(result.current.ultimoEditado).toBe('margem')
      await act(async () => { await vi.advanceTimersByTimeAsync(399) })
      expect(calcularTarifaMock).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })

      // 60 / (1 − 0,11 − 0,38) = 117,647… → 117,65 (centavos pra cima), margem 38,0025%
      expect(result.current.entrada.precoVenda).toBe(117.65)
      expect(result.current.statusCotacao).toBe('official')
      expect(result.current.cotacao.classico.comissaoTotal).toBe(12.94)
      expect(result.current.metaStatus).toBe('ok')
      expect(result.current.metaSolicitada).toBe(38)
      expect(result.current.margemEfetiva).toBeGreaterThanOrEqual(38)
      expect(result.current.margemExibida).toBe(result.current.margemEfetiva)
      const chamadas = calcularTarifaMock.mock.calls.length
      await avancarCotacao()
      await avancarCotacao()
      expect(calcularTarifaMock).toHaveBeenCalledTimes(chamadas)
    })

    it('duas metas: a 1ª resolvendo por último é descartada; vale a de 40', async () => {
      const primeira = adiado<Tarifa | null>()
      calcularTarifaMock
        .mockResolvedValueOnce(tarifaNoPreco(100))
        .mockImplementationOnce(() => primeira.promise)
        .mockImplementation(async (p: number) => tarifaNoPreco(p))
      const { result } = renderHook(() => useCalculadoraML(base), { wrapper })
      await avancarCotacao()

      act(() => result.current.editarMargem(30))
      await avancarSolver()
      const precoDa30 = calcularTarifaMock.mock.calls[1][0] as number
      act(() => result.current.editarMargem(40))
      await avancarSolver()
      const preco40 = result.current.entrada.precoVenda
      expect(result.current.metaStatus).toBe('ok')
      expect(result.current.margemEfetiva).toBeGreaterThanOrEqual(40 - 1e-9)

      await act(async () => { primeira.resolve(tarifaNoPreco(precoDa30)) })

      expect(result.current.entrada.precoVenda).toBe(preco40)
      expect(result.current.metaSolicitada).toBe(40)
      expect(result.current.metaStatus).toBe('ok')
    })

    it('editarPreco antes da resposta descarta o solver', async () => {
      const solver = adiado<Tarifa | null>()
      calcularTarifaMock
        .mockResolvedValueOnce(tarifaNoPreco(100))
        .mockImplementationOnce(() => solver.promise)
        .mockImplementation(async (p: number) => tarifaNoPreco(p))
      const { result } = renderHook(() => useCalculadoraML(base), { wrapper })
      await avancarCotacao()

      act(() => result.current.editarMargem(38))
      await avancarSolver()
      act(() => result.current.editarPreco(90))
      await act(async () => { solver.resolve(tarifaNoPreco(117.65)) })
      await avancarCotacao()

      expect(result.current.entrada.precoVenda).toBe(90)
      expect(result.current.metaSolicitada).toBeNull()
      expect(result.current.metaStatus).toBeNull()
      expect(result.current.ultimoEditado).toBe('preco')
    })

    it('trocar de produto com o solver em voo descarta o solver', async () => {
      const solver = adiado<Tarifa | null>()
      calcularTarifaMock
        .mockResolvedValueOnce(tarifaNoPreco(100))
        .mockImplementationOnce(() => solver.promise)
        .mockImplementation(async (p: number) => tarifaNoPreco(p))
      fetchVariacoesMock.mockResolvedValue([variacao('SKU-2', { custo: 31, preco: 51 })])
      const { result } = renderHook(() => useCalculadoraML(base), { wrapper })
      await avancarCotacao()

      act(() => result.current.editarMargem(38))
      await avancarSolver()
      await act(async () => { await result.current.selecionarProduto(produtoResumo) })
      await act(async () => { solver.resolve(tarifaNoPreco(117.65)) })

      expect(result.current.entrada.precoVenda).toBe(51)
      expect(result.current.metaSolicitada).toBeNull()
      expect(result.current.metaStatus).toBeNull()
    })

    it('solver não confirmado: melhor candidato, margem exibida é a efetiva, meta fica para o rótulo', async () => {
      calcularTarifaMock.mockImplementation(async (p: number) => tarifaNoPreco(p, 11, 'estimated'))
      const { result } = renderHook(
        () => useCalculadoraML({ ...base, taxasManuais: { frete: 10 } }),
        { wrapper },
      )
      await avancarCotacao()

      act(() => result.current.editarMargem(38))
      await avancarSolver()

      expect(result.current.entrada.precoVenda).toBe(117.65)
      expect(result.current.metaStatus).toBe('nao_confirmada')
      expect(result.current.metaSolicitada).toBe(38)
      expect(result.current.margemExibida).toBe(result.current.margemEfetiva)
      expect(result.current.margemExibida).not.toBe(38)
    })

    it('solver sem resposta (null) mantém o preço e marca não confirmada', async () => {
      calcularTarifaMock.mockResolvedValueOnce(tarifaNoPreco(100)).mockResolvedValue(null)
      const { result } = renderHook(() => useCalculadoraML(base), { wrapper })
      await avancarCotacao()

      act(() => result.current.editarMargem(38))
      await avancarSolver()

      expect(result.current.entrada.precoVenda).toBe(100)
      expect(result.current.metaStatus).toBe('nao_confirmada')
    })

    it('solver com exceção mantém o preço e marca não confirmada', async () => {
      calcularTarifaMock.mockResolvedValueOnce(tarifaNoPreco(100)).mockRejectedValue(new Error('rede'))
      const { result } = renderHook(() => useCalculadoraML(base), { wrapper })
      await avancarCotacao()

      act(() => result.current.editarMargem(38))
      await avancarSolver()

      expect(result.current.entrada.precoVenda).toBe(100)
      expect(result.current.metaStatus).toBe('nao_confirmada')
    })

    it('custo, imposto, medidas e modalidade depois da meta mantêm o preço', async () => {
      calcularTarifaMock.mockImplementation(async (p: number) => tarifaNoPreco(p))
      const { result } = renderHook(() => useCalculadoraML(base), { wrapper })
      await avancarCotacao()
      act(() => result.current.editarMargem(38))
      await avancarSolver()
      expect(result.current.entrada.precoVenda).toBe(117.65)

      act(() => result.current.atualizarEntrada({ custoProduto: 55 }))
      expect(result.current.ultimoEditado).toBe('preco')
      act(() => result.current.editarMargem(38))
      act(() => result.current.atualizarEntrada({ aliquotaImpostoPct: 8 }))
      expect(result.current.metaStatus).toBeNull()
      act(() => result.current.atualizarEntrada({ dimensoes: { ...dimensoes, pesoKg: 2 } }))
      act(() => result.current.setModalidadeAtiva('premium'))
      await avancarSolver()
      await avancarCotacao()

      expect(result.current.entrada.precoVenda).toBe(117.65)
      expect(result.current.ultimoEditado).toBe('preco')
      expect(result.current.metaSolicitada).toBe(38)
      expect(result.current.margemExibida).toBe(result.current.margemEfetiva)
      expect(result.current.margemEfetiva).toBe(result.current.resultado.modalidades.premium!.margemPctExata)
    })

    it('sem categoria: solver com cotação manual, sempre não confirmada', async () => {
      const { result } = renderHook(
        () => useCalculadoraML({ precoVenda: 100, custoProduto: 50, aliquotaImpostoPct: 0, taxasManuais: { percentualComissaoPct: 11, frete: 10 } }),
        { wrapper },
      )

      act(() => result.current.editarMargem(38))
      await avancarSolver()

      expect(calcularTarifaMock).not.toHaveBeenCalled()
      expect(result.current.entrada.precoVenda).toBe(117.65)
      expect(result.current.metaStatus).toBe('nao_confirmada')
    })

    it('Premium sem categoria: parte do premium derivado da cotação manual', async () => {
      const { result } = renderHook(
        () => useCalculadoraML({
          precoVenda: 100, custoProduto: 50, aliquotaImpostoPct: 0, modalidadeParaDecisao: 'premium',
          taxasManuais: { percentualComissaoPct: 11, frete: 10 },
        }),
        { wrapper },
      )

      act(() => result.current.editarMargem(38))
      await avancarSolver()

      // 60 / (1 − 0,16 − 0,38) = 130,434… → 130,44
      expect(result.current.entrada.precoVenda).toBe(130.44)
      expect(result.current.metaStatus).toBe('nao_confirmada')
    })

    it('rebate maior que os custos: margem efetiva 110% sem lançar; meta do motor segue 0', () => {
      const { result } = renderHook(
        () => useCalculadoraML({ precoVenda: 10, custoProduto: 1, rebate: 2, aliquotaImpostoPct: 0, taxasManuais: { freteRealmenteZero: true } }),
        { wrapper },
      )

      expect(result.current.margemEfetiva).toBeCloseTo(110, 9)
      expect(result.current.entrada.margemAlvoPct).toBe(0)
    })

    it('editarPreco zera a meta; sem meta o veredito é neutro e não cita meta', async () => {
      calcularTarifaMock.mockImplementation(async (p: number) => tarifaNoPreco(p))
      const { result } = renderHook(() => useCalculadoraML(base), { wrapper })
      await avancarCotacao()
      act(() => result.current.editarMargem(38))
      await avancarSolver()
      expect(result.current.entrada.margemAlvoPct).toBe(38)
      expect(JSON.stringify(result.current.resultado.veredito)).toMatch(/meta/i)

      act(() => result.current.editarPreco(150))
      await avancarCotacao()

      expect(result.current.metaSolicitada).toBeNull()
      expect(result.current.entrada.margemAlvoPct).toBe(0)
      expect(result.current.resultado.veredito.tipo).not.toBe('Comprar')
      expect(JSON.stringify(result.current.resultado.veredito)).not.toMatch(/meta/i)
      expect(result.current.resultado.veredito.fatores.join(' ')).toMatch(/margem/i)
      expect(result.current.resultado.veredito.fatores.join(' ')).toMatch(/lucro/i)
    })

    it('cotação comum que falhou não trava o solver: editarMargem cota por conta própria', async () => {
      calcularTarifaMock.mockResolvedValueOnce(null).mockImplementation(async (p: number) => tarifaNoPreco(p))
      const { result } = renderHook(() => useCalculadoraML(base), { wrapper })
      await avancarCotacao()
      expect(result.current.statusCotacao).toBe('estimated')

      act(() => result.current.editarMargem(38))
      await avancarSolver()

      expect(result.current.entrada.precoVenda).toBe(117.65)
      expect(result.current.metaStatus).toBe('ok')
      expect(result.current.statusCotacao).toBe('official')
    })

    it('cotação comum que falhou: editar o preço recota', async () => {
      calcularTarifaMock.mockResolvedValueOnce(null).mockImplementation(async (p: number) => tarifaNoPreco(p))
      const { result } = renderHook(() => useCalculadoraML(base), { wrapper })
      await avancarCotacao()

      act(() => result.current.editarPreco(120))
      await avancarCotacao()

      expect(calcularTarifaMock).toHaveBeenCalledTimes(2)
      expect(result.current.statusCotacao).toBe('official')
    })

    it('cotarEm tem identidade estável; muda só com categoria ou taxas', () => {
      const { result, rerender } = renderHook(() => useCalculadoraML(base), { wrapper })
      const primeiro = result.current.cotarEm

      rerender()
      act(() => result.current.atualizarEntrada({ custoProduto: 55 }))
      expect(result.current.cotarEm).toBe(primeiro)

      act(() => result.current.atualizarTaxasManuais({ taxaFixa: 1 }))
      const comTaxas = result.current.cotarEm
      expect(comTaxas).not.toBe(primeiro)

      act(() => result.current.atualizarEntrada({ categoriaId: 'MLB2' }))
      expect(result.current.cotarEm).not.toBe(comTaxas)
    })

    it('margem inválida (≥ 100 ou não finita) é ignorada', () => {
      const { result } = renderHook(() => useCalculadoraML(base), { wrapper })
      act(() => result.current.editarMargem(100))
      act(() => result.current.editarMargem(Number.NaN))
      expect(result.current.metaSolicitada).toBeNull()
      expect(result.current.metaStatus).toBeNull()
    })
  })

  describe('reducerCalculadora', () => {
    const carga = {
      entrada: { custoProduto: 0, precoVenda: 0, dimensoes: undefined, categoriaId: undefined },
      origem: null, modalidadeDoAnuncio: null, avisos: [], categoriaNome: null, variacaoUsada: null, anuncio: null,
    }

    it('PRODUTO_CARREGADO zera metaSolicitada, metaStatus e ultimoEditado', () => {
      const estado = { ...estadoInicialCalculadora(), metaSolicitada: 30, metaStatus: 'ok' as const, ultimoEditado: 'margem' as const }
      const proximo = reducerCalculadora(estado, { type: 'PRODUTO_CARREGADO', selecao: estado.selecaoProduto, carga, aliquotas: undefined })

      expect(proximo).toMatchObject({ metaSolicitada: null, metaStatus: null, ultimoEditado: 'preco' })
    })

    it('SOLVER_RESOLVIDO publica preço, tarifa e status juntos; descarta se a revisão mudou', () => {
      const comCategoria = estadoInicialCalculadora({ precoVenda: 100, categoriaId: 'MLB1' })
      const calculando = reducerCalculadora(comCategoria, { type: 'EDITAR_MARGEM', meta: 38 })
      const token = { revisao: calculando.revisao, entrada: calculando.entrada }
      const resolvido = reducerCalculadora(calculando, {
        type: 'SOLVER_RESOLVIDO', ...token, preco: 117.65, tarifa: tarifaOficial(), confirmado: true,
      })
      expect(resolvido).toMatchObject({ metaStatus: 'ok', tarifa: tarifaOficial(), statusCotacao: 'official' })
      expect(resolvido.entrada.precoVenda).toBe(117.65)
      expect(resolvido.chaveCotada?.startsWith('117.65|MLB1')).toBe(true)

      const editado = reducerCalculadora(calculando, { type: 'EDITAR_ENTRADA', parcial: { custoProduto: 1 } })
      const antigo = reducerCalculadora(editado, {
        type: 'SOLVER_RESOLVIDO', ...token, preco: 117.65, tarifa: tarifaOficial(), confirmado: true,
      })
      expect(antigo).toBe(editado)
    })

    it('SOLVER_RESOLVIDO de uma meta anterior é descartado mesmo ainda calculando', () => {
      const calculando = reducerCalculadora(
        estadoInicialCalculadora({ precoVenda: 100, categoriaId: 'MLB1' }), { type: 'EDITAR_MARGEM', meta: 30 },
      )
      const token = { revisao: calculando.revisao, entrada: calculando.entrada }
      const segunda = reducerCalculadora(calculando, { type: 'EDITAR_MARGEM', meta: 40 })
      expect(segunda.entrada).toBe(calculando.entrada)

      const antigo = reducerCalculadora(segunda, {
        type: 'SOLVER_RESOLVIDO', ...token, preco: 101.7, tarifa: tarifaOficial(), confirmado: true,
      })
      expect(antigo).toBe(segunda)
    })

    it('SOLVER_RESOLVIDO é descartado se o sistema mudou a entrada (alíquotas chegaram)', () => {
      const comOrigem = { ...estadoInicialCalculadora({ precoVenda: 100, categoriaId: 'MLB1', aliquotaImpostoPct: null }), origemProduto: 'nacional' }
      const calculando = reducerCalculadora(comOrigem, { type: 'EDITAR_MARGEM', meta: 30 })
      const token = { revisao: calculando.revisao, entrada: calculando.entrada }
      const comAliquota = reducerCalculadora(calculando, { type: 'ALIQUOTAS', aliquotas: { nacional: 8, importado: 16, confirmada: true } })
      expect(comAliquota.revisao).toBe(calculando.revisao)

      const antigo = reducerCalculadora(comAliquota, {
        type: 'SOLVER_RESOLVIDO', ...token, preco: 101.7, tarifa: tarifaOficial(), confirmado: true,
      })
      expect(antigo).toBe(comAliquota)
    })

    it('SELECIONAR limpa avisos, anúncio, variação e categoria do produto anterior', () => {
      const anuncio = { publicado: true } as AnuncioCalculadora
      const estado = {
        ...estadoInicialCalculadora(), avisosProduto: ['aviso de A'], anuncio,
        variacaoUsada: { codigo: 'A1', cor: 'Azul' }, categoriaNome: 'Camisetas',
      }
      const proximo = reducerCalculadora(estado, { type: 'SELECIONAR', selecao: 1, produto: produtoResumo })

      expect(proximo).toMatchObject({ avisosProduto: [], anuncio: null, variacaoUsada: null, categoriaNome: null })
    })

    it('ALIQUOTAS zera o selo de meta (ok / nao_confirmada) mas mantém calculando', () => {
      const base = { ...estadoInicialCalculadora({ precoVenda: 100, aliquotaImpostoPct: null }), origemProduto: 'nacional', metaSolicitada: 30 }
      const aliquotas = { nacional: 8, importado: 16, confirmada: true }
      for (const metaStatus of ['ok', 'nao_confirmada'] as const) {
        expect(reducerCalculadora({ ...base, metaStatus }, { type: 'ALIQUOTAS', aliquotas })).toMatchObject({ metaStatus: null })
      }
      expect(reducerCalculadora({ ...base, metaStatus: 'calculando' }, { type: 'ALIQUOTAS', aliquotas }).metaStatus).toBe('calculando')
    })

    it('metaSolicitada inicial é null mesmo com margemAlvoPct nas opções', () => {
      expect(estadoInicialCalculadora({ margemAlvoPct: 20 }).metaSolicitada).toBeNull()
    })

    it('EDITAR_ENTRADA com parcial vazio (só margemAlvoPct) não muda o estado nem a revisão', () => {
      const inicial = estadoInicialCalculadora()
      expect(reducerCalculadora(inicial, { type: 'EDITAR_ENTRADA', parcial: {} })).toBe(inicial)
      expect(reducerCalculadora(inicial, { type: 'EDITAR_ENTRADA', parcial: { margemAlvoPct: 10 } })).toBe(inicial)
    })

    it('só ações do operador incrementam a revisão', () => {
      const inicial = estadoInicialCalculadora()
      const editado = reducerCalculadora(inicial, { type: 'EDITAR_ENTRADA', parcial: { custoProduto: 5 } })
      const modalidade = reducerCalculadora(editado, { type: 'MODALIDADE', modalidade: 'premium' })
      const taxas = reducerCalculadora(modalidade, { type: 'EDITAR_TAXAS', parcial: { taxaFixa: 1 } })
      expect(taxas.revisao).toBe(inicial.revisao + 3)

      // Cada ação do sistema precisa de fato mudar o estado — senão o teste passaria por early-return.
      const cargaNacional = { ...carga, origem: 'nacional', entrada: { ...carga.entrada, precoVenda: 50, categoriaId: 'MLB1' } }
      const carregado = reducerCalculadora(taxas, { type: 'PRODUTO_CARREGADO', selecao: taxas.selecaoProduto, carga: cargaNacional, aliquotas: undefined })
      expect(carregado.entrada).toMatchObject({ precoVenda: 50, categoriaId: 'MLB1', aliquotaImpostoPct: null })
      expect(carregado.statusCotacao).toBe('loading')
      expect(carregado.revisao).toBe(taxas.revisao)

      const aliquota = reducerCalculadora(carregado, { type: 'ALIQUOTAS', aliquotas: { nacional: 8, importado: 16, confirmada: true } })
      expect(aliquota.entrada.aliquotaImpostoPct).toBe(8)
      expect(aliquota.revisao).toBe(taxas.revisao)

      const cotado = reducerCalculadora(aliquota, { type: 'COTACAO_RECEBIDA', chave: aliquota.chaveCotada!, tarifa: tarifaOficial() })
      expect(cotado.tarifa).not.toBeNull()
      expect(cotado.statusCotacao).toBe('official')
      expect(cotado.revisao).toBe(taxas.revisao)
    })
  })
})
