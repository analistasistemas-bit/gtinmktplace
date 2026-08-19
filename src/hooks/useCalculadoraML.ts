import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  calcularSimulacaoML,
  type CotacaoManualPorModalidade,
  type CotacoesPorModalidade,
  type DimensoesProduto,
  type EntradaCalculadoraML,
} from '@/lib/calculadora-ml'
import { fetchProdutosEstoqueResumo, type ProdutoEstoqueResumo } from '@/lib/produtos-saldo'
import { QK } from '@/lib/queries'
import { calcularTarifaML, cotacoesOficiaisDaTarifa, type Tarifa } from '@/lib/tarifa'

const DEBOUNCE_COTACAO_MS = 300

export interface TaxasManuaisML {
  percentualComissaoPct: number
  taxaFixa: number
  frete: number | null
}

export interface ProdutoCalculadoraML extends ProdutoEstoqueResumo {
  custoProduto?: number | null
  precoVenda?: number | null
  dimensoes?: Partial<DimensoesProduto> | null
}

export interface UseCalculadoraMLOptions extends Partial<EntradaCalculadoraML> {
  taxasManuais?: Partial<TaxasManuaisML>
}

const ENTRADA_INICIAL: EntradaCalculadoraML = {
  precoVenda: 0,
  custoProduto: 0,
  aliquotaImpostoPct: 0,
  custosFixos: 0,
  custosVariaveis: 0,
  rebate: 0,
  margemAlvoPct: 0,
}

const TAXAS_MANUAIS_INICIAIS: TaxasManuaisML = {
  percentualComissaoPct: 0,
  taxaFixa: 0,
  frete: 0,
}

function arredondarMoeda(valor: number): number {
  return Number(valor.toFixed(2))
}

function criarCotacaoManual(
  precoVenda: number,
  taxas: TaxasManuaisML,
): CotacaoManualPorModalidade {
  return {
    origem: 'manual',
    classico: {
      percentualComissaoPct: taxas.percentualComissaoPct,
      taxaFixa: taxas.taxaFixa,
      comissaoTotal: arredondarMoeda(
        precoVenda * (taxas.percentualComissaoPct / 100) + taxas.taxaFixa,
      ),
      frete: taxas.frete,
      proveniencia: 'estimated',
    },
  }
}

function dimensoesDaTarifa(
  alturaCm?: number,
  larguraCm?: number,
  comprimentoCm?: number,
  pesoKg?: number,
) {
  if (
    alturaCm === undefined &&
    larguraCm === undefined &&
    comprimentoCm === undefined &&
    pesoKg === undefined
  ) return undefined
  return {
    alturaCm: alturaCm ?? null,
    larguraCm: larguraCm ?? null,
    comprimentoCm: comprimentoCm ?? null,
    pesoGramas: pesoKg === undefined ? null : pesoKg * 1000,
  }
}

function preencherProduto(
  entrada: EntradaCalculadoraML,
  produto: ProdutoCalculadoraML,
): EntradaCalculadoraML {
  const proxima = { ...entrada }
  if (Number.isFinite(produto.custoProduto)) proxima.custoProduto = produto.custoProduto as number
  if (Number.isFinite(produto.precoVenda)) proxima.precoVenda = produto.precoVenda as number

  const dimensoes = produto.dimensoes
  if (
    dimensoes &&
    Number.isFinite(dimensoes.alturaCm) &&
    Number.isFinite(dimensoes.larguraCm) &&
    Number.isFinite(dimensoes.comprimentoCm) &&
    Number.isFinite(dimensoes.pesoKg)
  ) {
    proxima.dimensoes = dimensoes as DimensoesProduto
  }
  return proxima
}

/**
 * Estado editável da calculadora. A cotação oficial é solicitada quando há preço e categoria;
 * até responder (ou ao falhar), o motor recebe a cotação manual e marca o resultado estimado.
 */
export function useCalculadoraML(opcoes: UseCalculadoraMLOptions = {}) {
  const { taxasManuais: taxasIniciais, ...entradaInicial } = opcoes
  const [entrada, setEntrada] = useState<EntradaCalculadoraML>(() => ({
    ...ENTRADA_INICIAL,
    ...entradaInicial,
  }))
  const [taxasManuais, setTaxasManuais] = useState<TaxasManuaisML>(() => ({
    ...TAXAS_MANUAIS_INICIAIS,
    ...taxasIniciais,
  }))
  const [tarifaOficial, setTarifaOficial] = useState<Tarifa | null>(null)
  const [statusCotacao, setStatusCotacao] = useState<'idle' | 'loading' | 'official' | 'estimated'>('idle')
  const [avisoApi, setAvisoApi] = useState<string | null>(null)
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProdutoCalculadoraML | null>(null)
  const [cotacaoMeta, setCotacaoMeta] = useState<Tarifa | null>(null)
  const [erroMeta, setErroMeta] = useState<string | null>(null)
  const sequenciaCotacao = useRef(0)
  const sequenciaMeta = useRef(0)

  const produtos = useQuery({
    queryKey: QK.produtosEstoqueResumo,
    queryFn: fetchProdutosEstoqueResumo,
    staleTime: 5 * 60_000,
  })

  const cotacaoManual = useMemo(
    () => criarCotacaoManual(entrada.precoVenda, taxasManuais),
    [entrada.precoVenda, taxasManuais],
  )
  const dimensoesCotacao = useMemo(
    () => dimensoesDaTarifa(
      entrada.dimensoes?.alturaCm,
      entrada.dimensoes?.larguraCm,
      entrada.dimensoes?.comprimentoCm,
      entrada.dimensoes?.pesoKg,
    ),
    [
      entrada.dimensoes?.alturaCm,
      entrada.dimensoes?.larguraCm,
      entrada.dimensoes?.comprimentoCm,
      entrada.dimensoes?.pesoKg,
    ],
  )
  const cotacao: CotacoesPorModalidade = tarifaOficial
    ? cotacoesOficiaisDaTarifa(tarifaOficial)
    : cotacaoManual
  const resultado = useMemo(
    () => calcularSimulacaoML(entrada, cotacao),
    [entrada, cotacao],
  )

  const atualizarEntrada = useCallback((parcial: Partial<EntradaCalculadoraML>) => {
    sequenciaCotacao.current += 1
    sequenciaMeta.current += 1
    setTarifaOficial(null)
    setCotacaoMeta(null)
    setErroMeta(null)
    setEntrada((atual) => ({ ...atual, ...parcial }))
  }, [])

  const atualizarTaxasManuais = useCallback((parcial: Partial<TaxasManuaisML>) => {
    sequenciaCotacao.current += 1
    sequenciaMeta.current += 1
    setTarifaOficial(null)
    setCotacaoMeta(null)
    setErroMeta(null)
    setStatusCotacao('estimated')
    setAvisoApi('Taxas manuais estimadas estão ativas; valide na API antes de decidir.')
    setTaxasManuais((atual) => ({ ...atual, ...parcial }))
  }, [])

  const selecionarProduto = useCallback((produto: ProdutoCalculadoraML | null) => {
    sequenciaMeta.current += 1
    setProdutoSelecionado(produto)
    setCotacaoMeta(null)
    setErroMeta(null)
    if (!produto) return
    sequenciaCotacao.current += 1
    setTarifaOficial(null)
    setEntrada((atual) => preencherProduto(atual, produto))
  }, [])

  useEffect(() => {
    const id = ++sequenciaCotacao.current
    const categoriaId = entrada.categoriaId?.trim()
    if (!categoriaId) {
      setTarifaOficial(null)
      setStatusCotacao('idle')
      setAvisoApi('Informe uma categoria para consultar as taxas oficiais; a simulação está estimada.')
      return
    }
    if (entrada.precoVenda <= 0) {
      setTarifaOficial(null)
      setStatusCotacao('idle')
      setAvisoApi('Informe um preço de venda para consultar as taxas oficiais; a simulação está estimada.')
      return
    }

    setTarifaOficial(null)
    setStatusCotacao('loading')
    setAvisoApi('Consultando taxas oficiais; a simulação atual é estimada.')
    const timer = window.setTimeout(() => {
      void calcularTarifaML(
        entrada.precoVenda,
        categoriaId,
        dimensoesCotacao,
        entrada.aliquotaImpostoPct,
      )
        .then((tarifa) => {
          if (sequenciaCotacao.current !== id) return
          if (!tarifa) {
            setStatusCotacao('estimated')
            setAvisoApi('Cotação oficial indisponível; a simulação usa taxas manuais estimadas.')
            return
          }
          setTarifaOficial(tarifa)
          setStatusCotacao('official')
          setAvisoApi(null)
        })
        .catch(() => {
          if (sequenciaCotacao.current !== id) return
          setTarifaOficial(null)
          setStatusCotacao('estimated')
          setAvisoApi('Cotação oficial indisponível; a simulação usa taxas manuais estimadas.')
        })
    }, DEBOUNCE_COTACAO_MS)
    return () => window.clearTimeout(timer)
  }, [
    entrada.precoVenda,
    entrada.categoriaId,
    entrada.aliquotaImpostoPct,
    dimensoesCotacao,
  ])

  const validarNaApi = useCallback(async (): Promise<Tarifa | null> => {
    const id = ++sequenciaMeta.current
    const modalidade = entrada.modalidadeParaDecisao ?? 'classico'
    const precoProjetado = resultado.modalidades[modalidade]?.precoAlvo.valor
    const categoriaId = entrada.categoriaId?.trim()
    if (!categoriaId || !precoProjetado || precoProjetado <= 0) {
      setErroMeta('Informe categoria e dados suficientes para validar o preço projetado na API.')
      return null
    }
    setErroMeta(null)
    setCotacaoMeta(null)
    try {
      const tarifa = await calcularTarifaML(
        precoProjetado,
        categoriaId,
        dimensoesCotacao,
        entrada.aliquotaImpostoPct,
      )
      if (sequenciaMeta.current !== id) return null
      if (!tarifa) setErroMeta('A API não retornou uma cotação para o preço projetado.')
      setCotacaoMeta(tarifa)
      return tarifa
    } catch {
      if (sequenciaMeta.current !== id) return null
      setErroMeta('Não foi possível validar o preço projetado na API.')
      return null
    }
  }, [entrada, dimensoesCotacao, resultado])

  return {
    entrada,
    atualizarEntrada,
    taxasManuais,
    atualizarTaxasManuais,
    produtoSelecionado,
    selecionarProduto,
    produtos,
    cotacao,
    statusCotacao,
    aviso: avisoApi,
    resultado,
    validarNaApi,
    cotacaoMeta,
    erroMeta,
  }
}
