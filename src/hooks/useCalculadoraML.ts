import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  calcularSimulacaoML,
  type CotacaoManualPorModalidade,
  type CotacoesPorModalidade,
  type DimensoesProduto,
  type EntradaCalculadoraML,
  type Proveniencia,
} from '@/lib/calculadora-ml'
import {
  fetchProdutosEstoqueResumo,
  fetchVariacoesProduto,
  type ProdutoEstoqueResumo,
  type VariacaoComSaldo,
} from '@/lib/produtos-saldo'
import { QK } from '@/lib/queries'
import { calcularTarifaML, cotacoesOficiaisDaTarifa, type Tarifa } from '@/lib/tarifa'

const DEBOUNCE_COTACAO_MS = 300

export interface TaxasManuaisML {
  percentualComissaoPct: number
  taxaFixa: number
  frete: number | null
  freteRealmenteZero: boolean
}

export type ProdutoCalculadoraML = ProdutoEstoqueResumo

export interface ValidacaoMetaML {
  modalidade: 'classico' | 'premium'
  margemPct: number
  proveniencia: Proveniencia
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
  freteRealmenteZero: false,
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
      frete: freteManualConfirmado(taxas),
      proveniencia: 'estimated',
    },
  }
}

function freteManualConfirmado(taxas: TaxasManuaisML): number | null {
  if (taxas.frete === null) return null
  return taxas.frete > 0 || taxas.freteRealmenteZero ? taxas.frete : null
}

function cotacaoOficialComFreteConfirmado(
  tarifa: Tarifa,
  entrada: EntradaCalculadoraML,
  taxas: TaxasManuaisML,
): CotacoesPorModalidade {
  const cotacao = cotacoesOficiaisDaTarifa(tarifa)
  if (entrada.dimensoes) return cotacao

  const frete = freteManualConfirmado(taxas)
  return {
    origem: 'official',
    classico: { ...cotacao.classico, frete, proveniencia: 'partial' },
    premium: { ...cotacao.premium, frete, proveniencia: 'partial' },
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
  variacao: VariacaoComSaldo,
): EntradaCalculadoraML {
  const proxima = { ...entrada }
  if (variacao.custo !== null && Number.isFinite(variacao.custo)) {
    proxima.custoProduto = variacao.custo
  }
  if (Number.isFinite(variacao.preco)) proxima.precoVenda = variacao.preco

  const dimensoes = dimensoesDaVariacao(variacao)
  if (dimensoes) {
    proxima.dimensoes = dimensoes
  }
  return proxima
}

function dimensoesDaVariacao(variacao: VariacaoComSaldo): DimensoesProduto | undefined {
  const alturaCm = variacao.alturaCm
  const larguraCm = variacao.larguraCm
  const comprimentoCm = variacao.comprimentoCm
  const pesoKg = variacao.pesoGramas === null ? null : variacao.pesoGramas / 1000
  if (
    alturaCm === null || larguraCm === null || comprimentoCm === null || pesoKg === null ||
    !Number.isFinite(alturaCm) || !Number.isFinite(larguraCm) ||
    !Number.isFinite(comprimentoCm) || !Number.isFinite(pesoKg) ||
    alturaCm <= 0 || larguraCm <= 0 || comprimentoCm <= 0 || pesoKg <= 0
  ) return undefined
  return {
    alturaCm,
    larguraCm,
    comprimentoCm,
    pesoKg,
  }
}

function variacaoTemDadosUsaveis(variacao: VariacaoComSaldo): boolean {
  return (
    (variacao.custo !== null && Number.isFinite(variacao.custo)) ||
    variacao.preco > 0 ||
    dimensoesDaVariacao(variacao) !== undefined
  )
}

function escolherVariacao(
  produto: ProdutoCalculadoraML,
  variacoes: VariacaoComSaldo[],
): VariacaoComSaldo | undefined {
  return (
    (produto.skuUnico
      ? variacoes.find((variacao) => variacao.codigo === produto.skuUnico)
      : undefined) ??
    variacoes.find(variacaoTemDadosUsaveis) ??
    variacoes[0]
  )
}

function entradaAlteraChaveCotacao(parcial: Partial<EntradaCalculadoraML>): boolean {
  return ['precoVenda', 'categoriaId', 'aliquotaImpostoPct', 'dimensoes'].some((chave) =>
    Object.prototype.hasOwnProperty.call(parcial, chave),
  )
}

function variacaoAlteraChaveCotacao(variacao: VariacaoComSaldo): boolean {
  return Number.isFinite(variacao.preco) || dimensoesDaVariacao(variacao) !== undefined
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
  const [statusCotacao, setStatusCotacao] = useState<'idle' | 'loading' | 'official' | 'partial' | 'estimated'>('idle')
  const [avisoApi, setAvisoApi] = useState<string | null>(null)
  const [produtoSelecionado, setProdutoSelecionado] = useState<ProdutoCalculadoraML | null>(null)
  const [cotacaoMeta, setCotacaoMeta] = useState<Tarifa | null>(null)
  const [validacaoMeta, setValidacaoMeta] = useState<ValidacaoMetaML | null>(null)
  const [erroMeta, setErroMeta] = useState<string | null>(null)
  const sequenciaCotacao = useRef(0)
  const sequenciaMeta = useRef(0)
  const sequenciaProduto = useRef(0)
  const taxasManuaisRef = useRef(taxasManuais)
  taxasManuaisRef.current = taxasManuais

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
    ? cotacaoOficialComFreteConfirmado(tarifaOficial, entrada, taxasManuais)
    : cotacaoManual
  const resultado = useMemo(
    () => calcularSimulacaoML(entrada, cotacao),
    [entrada, cotacao],
  )

  const atualizarEntrada = useCallback((parcial: Partial<EntradaCalculadoraML>) => {
    sequenciaMeta.current += 1
    setCotacaoMeta(null)
    setValidacaoMeta(null)
    setErroMeta(null)
    if (entradaAlteraChaveCotacao(parcial)) {
      sequenciaCotacao.current += 1
      setTarifaOficial(null)
      setStatusCotacao('loading')
    }
    setEntrada((atual) => ({ ...atual, ...parcial }))
  }, [])

  const atualizarTaxasManuais = useCallback((parcial: Partial<TaxasManuaisML>) => {
    sequenciaMeta.current += 1
    setCotacaoMeta(null)
    setValidacaoMeta(null)
    setErroMeta(null)
    if (!tarifaOficial) {
      setStatusCotacao('estimated')
      setAvisoApi('Taxas manuais estimadas estão ativas; valide na API antes de decidir.')
    }
    setTaxasManuais((atual) => ({ ...atual, ...parcial }))
  }, [tarifaOficial])

  const selecionarProduto = useCallback(async (produto: ProdutoCalculadoraML | null) => {
    const id = ++sequenciaProduto.current
    sequenciaMeta.current += 1
    setProdutoSelecionado(produto)
    setCotacaoMeta(null)
    setValidacaoMeta(null)
    setErroMeta(null)
    if (!produto) return

    try {
      const variacoes = await fetchVariacoesProduto(produto.codigoPai)
      if (sequenciaProduto.current !== id) return
      const variacao = escolherVariacao(produto, variacoes)
      if (!variacao) return
      if (variacaoAlteraChaveCotacao(variacao)) {
        sequenciaCotacao.current += 1
        setTarifaOficial(null)
        setStatusCotacao('loading')
      }
      setEntrada((atual) => preencherProduto(atual, variacao))
    } catch {
      // A seleção continua útil mesmo que o prefill opcional falhe.
    }
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
          if (entrada.dimensoes) {
            setStatusCotacao('official')
            setAvisoApi(null)
          } else {
            setStatusCotacao('partial')
            setAvisoApi(
              freteManualConfirmado(taxasManuaisRef.current) === null
                ? 'Comissão oficial aplicada; confirme o frete manual para decidir.'
                : 'Comissão oficial aplicada com frete manual confirmado.',
            )
          }
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
    entrada.dimensoes,
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
    setValidacaoMeta(null)
    try {
      const tarifa = await calcularTarifaML(
        precoProjetado,
        categoriaId,
        dimensoesCotacao,
        entrada.aliquotaImpostoPct,
      )
      if (sequenciaMeta.current !== id) return null
      if (!tarifa) {
        setErroMeta('A API não retornou uma cotação para o preço projetado.')
        return null
      }
      const resultadoValidado = calcularSimulacaoML(
        { ...entrada, precoVenda: precoProjetado },
        cotacaoOficialComFreteConfirmado(tarifa, entrada, taxasManuais),
      )
      const resultadoModalidade = resultadoValidado.modalidades[modalidade]
      if (
        !resultadoModalidade ||
        resultadoModalidade.margemPct < entrada.margemAlvoPct - 0.01
      ) {
        const margem = resultadoModalidade?.margemPct
        setErroMeta(
          margem === undefined
            ? 'A cotação oficial não confirmou a margem-alvo: faltam dados de frete.'
            : `A cotação oficial não confirmou a margem-alvo de ${entrada.margemAlvoPct.toLocaleString('pt-BR')}% (margem recalculada: ${margem.toLocaleString('pt-BR')}%).`,
        )
        return null
      }
      setCotacaoMeta(tarifa)
      setValidacaoMeta({
        modalidade,
        margemPct: resultadoModalidade.margemPct,
        proveniencia: resultadoModalidade.proveniencia,
      })
      return tarifa
    } catch {
      if (sequenciaMeta.current !== id) return null
      setErroMeta('Não foi possível validar o preço projetado na API.')
      return null
    }
  }, [entrada, dimensoesCotacao, resultado, taxasManuais])

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
    validacaoMeta,
    erroMeta,
  }
}
