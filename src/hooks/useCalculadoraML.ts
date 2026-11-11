import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAliquotas } from '@/hooks/useConfiguracoes'
import { fetchAnuncioCalculadora, type AnuncioCalculadora } from '@/lib/anuncio-calculadora'
import {
  calcularSimulacaoML,
  normalizarCotacoes,
  type CotacaoManualPorModalidade,
  type CotacoesOficiaisPorModalidade,
  type CotacoesPorModalidade,
  type DimensoesProduto,
  type EntradaCalculadoraML,
  type ModalidadeML,
} from '@/lib/calculadora-ml'
import { precoPorMargem, type CotarEm } from '@/lib/calculadora-ml-preco'
import { aliquotaDoKit } from '@/lib/kit-variacao-simulacao'
import {
  fetchProdutosEstoqueResumo,
  fetchVariacoesProduto,
  type ProdutoEstoqueResumo,
  type VariacaoComSaldo,
} from '@/lib/produtos-saldo'
import { QK } from '@/lib/queries'
import {
  calcularTarifaML,
  cotacoesOficiaisDaTarifa,
  provenienciaDaTarifa,
  type Tarifa,
} from '@/lib/tarifa'

const DEBOUNCE_COTACAO_MS = 300
const DEBOUNCE_MARGEM_MS = 400

export interface TaxasManuaisML {
  percentualComissaoPct: number
  taxaFixa: number
  frete: number | null
  freteRealmenteZero: boolean
}

export type ProdutoCalculadoraML = ProdutoEstoqueResumo

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

/**
 * Cotação da calculadora (B1): só a tarifa `official` (falhando fechado via
 * `provenienciaDaTarifa`) traz o frete do ML. `partial`/`estimated` mantêm a comissão da tarifa,
 * usam o frete manual confirmado (ou `null` = desconhecido) e preservam a proveniência — nunca
 * promovem. A Revisão segue com `cotacoesOficiaisDaTarifa` sem mudança.
 */
export function cotacaoCalculadora(
  tarifa: Tarifa,
  taxas: TaxasManuaisML,
): CotacoesOficiaisPorModalidade {
  const cotacao = cotacoesOficiaisDaTarifa(tarifa)
  const { proveniencia } = provenienciaDaTarifa(tarifa)
  if (proveniencia === 'official') return cotacao

  const frete = freteManualConfirmado(taxas)
  return {
    origem: 'official',
    classico: { ...cotacao.classico, frete, proveniencia },
    premium: { ...cotacao.premium, frete, proveniencia },
  }
}

function avisoDaTarifa(tarifa: Tarifa, taxas: TaxasManuaisML): string | null {
  const { proveniencia, motivo } = provenienciaDaTarifa(tarifa)
  if (proveniencia === 'official') return null
  const detalhe = motivo ? ` (${motivo})` : ''
  const prefixo = proveniencia === 'partial'
    ? `Comissão oficial aplicada; frete não oficial${detalhe}`
    : `Cotação estimada${detalhe}`
  return freteManualConfirmado(taxas) === null
    ? `${prefixo}. Confirme o frete manual para decidir.`
    : `${prefixo}. Usando o frete manual confirmado.`
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
  // `fetchVariacoesProduto` devolve em ordem alfabética de cor (o card e a entrada leem a
  // lista pelo nome da cor). O prefill NÃO pode depender dessa ordem: quem alimenta preço e
  // dimensões da cotação continua sendo a de menor código, como antes da ordenação por cor.
  const porCodigo = [...variacoes].sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'))
  return (
    (produto.skuUnico
      ? porCodigo.find((variacao) => variacao.codigo === produto.skuUnico)
      : undefined) ??
    porCodigo.find(variacaoTemDadosUsaveis) ??
    porCodigo[0]
  )
}

type StatusCotacao = 'idle' | 'loading' | 'official' | 'partial' | 'estimated'
export type MetaStatus = 'ok' | 'calculando' | 'nao_confirmada'
type Aliquotas = { nacional: number; importado: number; confirmada: boolean }
type CampoTocavel = 'custoProduto' | 'precoVenda' | 'dimensoes' | 'categoriaId' | 'modalidadeParaDecisao'

/** O que a seleção de um produto substitui de uma vez (B2). Ausente = limpo. A alíquota é
 *  derivada no reducer de `origem` + alíquotas da org, nunca presumida. */
export interface CargaProduto {
  entrada: Pick<EntradaCalculadoraML, 'custoProduto' | 'precoVenda' | 'dimensoes' | 'categoriaId'>
  /** `familias.origem` ('nacional' | 'importado' | outro); null = sem produto (avulso). */
  origem: string | null
  modalidadeDoAnuncio: ModalidadeML | null
  avisos: string[]
  categoriaNome: string | null
  variacaoUsada: { codigo: string; cor: string | null } | null
  anuncio: AnuncioCalculadora | null
}

export interface EstadoCalculadoraML {
  /** Só ações do operador incrementam. Valida o solver (Task 5). */
  revisao: number
  /** Token da seleção: valida o prefill; edições do operador não o invalidam. */
  selecaoProduto: number
  produtoSelecionado: ProdutoCalculadoraML | null
  entrada: EntradaCalculadoraML
  taxasManuais: TaxasManuaisML
  /** Tarifa crua da chave atual; a cotação é derivada no render com as taxas manuais (Task 2). */
  tarifa: Tarifa | null
  /** Chave preço|categoria|dimensões da cotação em voo/publicada. */
  chaveCotada: string | null
  statusCotacao: StatusCotacao
  avisoApi: string | null
  modalidade: ModalidadeML
  modalidadeDoAnuncio: ModalidadeML | null
  impostoManual: boolean
  /** Campos editados pelo operador desde a seleção atual: o prefill não os sobrescreve. */
  camposTocados: CampoTocavel[]
  origemProduto: string | null
  avisosProduto: string[]
  categoriaNome: string | null
  variacaoUsada: { codigo: string; cor: string | null } | null
  anuncio: AnuncioCalculadora | null
  /** Margem digitada pelo operador (I3). Nasce em EDITAR_MARGEM; zera ao editar o preço ou trocar
   *  de produto; persiste (como rótulo) nas demais edições. É a meta do motor (`?? 0`). */
  metaSolicitada: number | null
  metaStatus: MetaStatus | null
  ultimoEditado: 'preco' | 'margem'
}

export type AcaoCalculadoraML =
  | { type: 'EDITAR_ENTRADA'; parcial: Partial<EntradaCalculadoraML> }
  | { type: 'EDITAR_TAXAS'; parcial: Partial<TaxasManuaisML> }
  | { type: 'MODALIDADE'; modalidade: ModalidadeML }
  | { type: 'SELECIONAR'; selecao: number; produto: ProdutoCalculadoraML | null }
  | { type: 'PRODUTO_CARREGADO'; selecao: number; carga: CargaProduto; aliquotas: Aliquotas | undefined }
  | { type: 'ALIQUOTAS'; aliquotas: Aliquotas }
  | { type: 'COTACAO_RECEBIDA'; chave: string; tarifa: Tarifa | null }
  | { type: 'EDITAR_MARGEM'; meta: number }
  /** Token = revisão + entrada (identidade) do início do solver. `preco` null = falhou. */
  | { type: 'SOLVER_RESOLVIDO'; revisao: number; entrada: EntradaCalculadoraML; preco: number | null; tarifa: Tarifa | null; confirmado: boolean }

const AVISO_INDISPONIVEL = 'Cotação oficial indisponível; a simulação usa taxas manuais estimadas.'
const AVISO_PRECO_NO_AR = 'Preço do cadastro — não foi possível ler o preço no ar.'

function chaveCotacao(entrada: EntradaCalculadoraML): string {
  const d = entrada.dimensoes
  return [entrada.precoVenda, entrada.categoriaId?.trim() ?? '', d?.alturaCm, d?.larguraCm, d?.comprimentoCm, d?.pesoKg].join('|')
}

function motivoSemCotacao(entrada: EntradaCalculadoraML): string | null {
  if (!entrada.categoriaId?.trim()) return 'Informe uma categoria para consultar as taxas oficiais; a simulação está estimada.'
  if (!(entrada.precoVenda > 0)) return 'Informe um preço de venda para consultar as taxas oficiais; a simulação está estimada.'
  return null
}

/** Cotação comum é válida pela própria chave: só uma chave nova derruba a tarifa e recota. */
function comChave(estado: EstadoCalculadoraML): EstadoCalculadoraML {
  const chave = chaveCotacao(estado.entrada)
  if (chave === estado.chaveCotada) return estado
  const motivo = motivoSemCotacao(estado.entrada)
  return {
    ...estado,
    chaveCotada: chave,
    tarifa: null,
    statusCotacao: motivo ? 'idle' : 'loading',
    avisoApi: motivo ?? 'Consultando taxas oficiais; a simulação atual é estimada.',
  }
}

/** Edição do operador fora da margem: o preço manda. Meta fica como rótulo, salvo se o preço mudou. */
function precoManda(estado: EstadoCalculadoraML, zeraMeta: boolean) {
  return {
    ultimoEditado: 'preco' as const,
    metaStatus: null,
    metaSolicitada: zeraMeta ? null : estado.metaSolicitada,
  }
}

function tocar(campos: CampoTocavel[], parcial: object): CampoTocavel[] {
  const novos = (['custoProduto', 'precoVenda', 'dimensoes', 'categoriaId', 'modalidadeParaDecisao'] as const)
    .filter((c) => Object.prototype.hasOwnProperty.call(parcial, c) && !campos.includes(c))
  return novos.length ? [...campos, ...novos] : campos
}

export function reducerCalculadora(estado: EstadoCalculadoraML, acao: AcaoCalculadoraML): EstadoCalculadoraML {
  switch (acao.type) {
    case 'EDITAR_ENTRADA': {
      // A margem só entra por EDITAR_MARGEM; a meta do motor é derivada de `metaSolicitada`.
      const parcial = { ...acao.parcial }
      delete parcial.margemAlvoPct
      if (Object.keys(parcial).length === 0) return estado
      const modalidade = parcial.modalidadeParaDecisao ?? estado.modalidade
      return comChave({
        ...estado,
        ...precoManda(estado, 'precoVenda' in parcial),
        revisao: estado.revisao + 1,
        entrada: { ...estado.entrada, ...parcial, modalidadeParaDecisao: modalidade },
        modalidade,
        impostoManual: estado.impostoManual || 'aliquotaImpostoPct' in parcial,
        camposTocados: tocar(estado.camposTocados, parcial),
      })
    }
    case 'EDITAR_TAXAS':
      return {
        ...estado,
        ...precoManda(estado, false),
        revisao: estado.revisao + 1,
        taxasManuais: { ...estado.taxasManuais, ...acao.parcial },
        ...(estado.tarifa ? {} : {
          statusCotacao: 'estimated' as const,
          avisoApi: 'Taxas manuais estimadas estão ativas; confirme o frete manual para decidir.',
        }),
      }
    case 'MODALIDADE':
      return {
        ...estado,
        ...precoManda(estado, false),
        revisao: estado.revisao + 1,
        modalidade: acao.modalidade,
        entrada: { ...estado.entrada, modalidadeParaDecisao: acao.modalidade },
        camposTocados: tocar(estado.camposTocados, { modalidadeParaDecisao: acao.modalidade }),
      }
    case 'SELECIONAR':
      return {
        ...estado,
        selecaoProduto: acao.selecao,
        produtoSelecionado: acao.produto,
        // Nada do produto anterior aparece sob o nome do novo até o prefill terminar.
        avisosProduto: [],
        anuncio: null,
        variacaoUsada: null,
        categoriaNome: null,
        camposTocados: [],
        impostoManual: false,
      }
    case 'PRODUTO_CARREGADO': {
      if (acao.selecao !== estado.selecaoProduto) return estado
      const { carga } = acao
      const tocado = (c: CampoTocavel) => estado.camposTocados.includes(c)
      const doProduto = <K extends keyof CargaProduto['entrada']>(c: K) =>
        tocado(c) ? estado.entrada[c] : carga.entrada[c]
      const modalidade = tocado('modalidadeParaDecisao')
        ? estado.modalidade
        : carga.modalidadeDoAnuncio ?? estado.modalidade
      return comChave({
        ...estado,
        entrada: {
          ...estado.entrada,
          custoProduto: doProduto('custoProduto'),
          precoVenda: doProduto('precoVenda'),
          dimensoes: doProduto('dimensoes'),
          categoriaId: doProduto('categoriaId'),
          aliquotaImpostoPct: estado.impostoManual
            ? estado.entrada.aliquotaImpostoPct
            : aliquotaDoKit(carga.origem, acao.aliquotas),
          modalidadeParaDecisao: modalidade,
        },
        modalidade,
        modalidadeDoAnuncio: carga.modalidadeDoAnuncio,
        origemProduto: carga.origem,
        avisosProduto: carga.avisos,
        categoriaNome: carga.categoriaNome,
        variacaoUsada: carga.variacaoUsada,
        anuncio: carga.anuncio,
        metaSolicitada: null,
        metaStatus: null,
        ultimoEditado: 'preco',
      })
    }
    case 'ALIQUOTAS': {
      if (estado.origemProduto === null || estado.impostoManual) return estado
      const aliquota = aliquotaDoKit(estado.origemProduto, acao.aliquotas)
      if (aliquota === estado.entrada.aliquotaImpostoPct) return estado
      // Selo 'ok'/'nao_confirmada' era do imposto antigo: some. 'calculando' segue (o solver reinicia).
      const seloVelho = estado.metaStatus === 'ok' || estado.metaStatus === 'nao_confirmada'
      return {
        ...estado,
        entrada: { ...estado.entrada, aliquotaImpostoPct: aliquota },
        ...(seloVelho ? { metaStatus: null } : {}),
      }
    }
    case 'COTACAO_RECEBIDA':
      if (acao.chave !== estado.chaveCotada) return estado
      if (!acao.tarifa) return { ...estado, tarifa: null, statusCotacao: 'estimated', avisoApi: AVISO_INDISPONIVEL }
      return {
        ...estado,
        tarifa: acao.tarifa,
        statusCotacao: provenienciaDaTarifa(acao.tarifa).proveniencia,
        avisoApi: null,
      }
    case 'EDITAR_MARGEM':
      if (!Number.isFinite(acao.meta) || acao.meta >= 100) return estado
      return {
        ...estado,
        revisao: estado.revisao + 1,
        metaSolicitada: acao.meta,
        metaStatus: 'calculando',
        ultimoEditado: 'margem',
      }
    case 'SOLVER_RESOLVIDO': {
      // Qualquer edição (revisão) ou mudança da entrada pelo sistema (prefill, alíquotas) invalida.
      if (
        acao.revisao !== estado.revisao ||
        acao.entrada !== estado.entrada ||
        estado.metaStatus !== 'calculando'
      ) return estado
      if (acao.preco === null) return { ...estado, metaStatus: 'nao_confirmada' }
      const entrada = { ...estado.entrada, precoVenda: acao.preco }
      const metaStatus = acao.confirmado ? 'ok' as const : 'nao_confirmada' as const
      if (!acao.tarifa) return comChave({ ...estado, entrada, metaStatus })
      // Preço + cotação desse preço numa ação só: a chave já nasce cotada (o effect não recota).
      return {
        ...estado,
        entrada,
        metaStatus,
        chaveCotada: chaveCotacao(entrada),
        tarifa: acao.tarifa,
        statusCotacao: provenienciaDaTarifa(acao.tarifa).proveniencia,
        avisoApi: null,
      }
    }
  }
}

export function estadoInicialCalculadora(opcoes: UseCalculadoraMLOptions = {}): EstadoCalculadoraML {
  const { taxasManuais, ...entradaInicial } = opcoes
  const modalidade = entradaInicial.modalidadeParaDecisao ?? 'classico'
  return comChave({
    revisao: 0,
    selecaoProduto: 0,
    produtoSelecionado: null,
    entrada: { ...ENTRADA_INICIAL, ...entradaInicial, modalidadeParaDecisao: modalidade },
    taxasManuais: { ...TAXAS_MANUAIS_INICIAIS, ...taxasManuais },
    tarifa: null,
    chaveCotada: null,
    statusCotacao: 'idle',
    avisoApi: null,
    modalidade,
    modalidadeDoAnuncio: null,
    impostoManual: false,
    camposTocados: [],
    origemProduto: null,
    avisosProduto: [],
    categoriaNome: null,
    variacaoUsada: null,
    anuncio: null,
    metaSolicitada: null,
    metaStatus: null,
    ultimoEditado: 'preco',
  })
}

/** Cotação num preço qualquer: com categoria, a tarifa do ML (null lança); sem, a manual. */
function criarCotarEm(
  categoriaId: string | undefined,
  taxas: TaxasManuaisML,
  aoCotar?: (preco: number, tarifa: Tarifa) => void,
): CotarEm {
  if (!categoriaId) return async (preco) => criarCotacaoManual(preco, taxas)
  return async (preco, e) => {
    const tarifa = await calcularTarifaML(preco, categoriaId, dimensoesDaTarifa(
      e.dimensoes?.alturaCm, e.dimensoes?.larguraCm, e.dimensoes?.comprimentoCm, e.dimensoes?.pesoKg,
    ), 0)
    if (!tarifa) throw new Error(`Tarifa indisponível em ${preco}.`)
    aoCotar?.(preco, tarifa)
    return cotacaoCalculadora(tarifa, taxas)
  }
}

const CARGA_VAZIA: CargaProduto = {
  entrada: { custoProduto: 0, precoVenda: 0, dimensoes: undefined, categoriaId: undefined },
  origem: null,
  modalidadeDoAnuncio: null,
  avisos: [],
  categoriaNome: null,
  variacaoUsada: null,
  anuncio: null,
}

const ROTULO_STATUS: Record<string, string> = { paused: 'pausado', closed: 'encerrado' }

function montarCarga(
  produto: ProdutoCalculadoraML,
  variacao: VariacaoComSaldo,
  anuncio: AnuncioCalculadora | null,
): CargaProduto {
  const avisos: string[] = []
  let precoVenda = Number.isFinite(variacao.preco) ? variacao.preco : 0
  if (!anuncio) {
    avisos.push(variacao.mlItemId ? AVISO_PRECO_NO_AR : 'Não foi possível ler a categoria do cadastro.')
  } else if (anuncio.publicado) {
    if (anuncio.preco === null) avisos.push(AVISO_PRECO_NO_AR)
    else {
      precoVenda = anuncio.preco
      if (anuncio.salePriceFalhou) avisos.push('Não foi possível ler a promoção no ML — usando o preço do anúncio.')
    }
    if (anuncio.categoriaFonte === 'cadastro') avisos.push('Categoria do cadastro — o anúncio não informou.')
    if (anuncio.statusAnuncio && anuncio.statusAnuncio !== 'active') {
      avisos.push(`Anúncio ${ROTULO_STATUS[anuncio.statusAnuncio] ?? `com status "${anuncio.statusAnuncio}"`} no ML.`)
    }
  } else {
    avisos.push('Sem anúncio no ML para esta variação — preço do cadastro.')
  }
  return {
    entrada: {
      custoProduto: variacao.custo !== null && Number.isFinite(variacao.custo) ? variacao.custo : 0,
      precoVenda,
      dimensoes: dimensoesDaVariacao(variacao),
      categoriaId: anuncio?.categoriaId ?? undefined,
    },
    origem: produto.origem,
    modalidadeDoAnuncio: anuncio?.publicado ? anuncio.modalidade : null,
    avisos,
    categoriaNome: anuncio?.categoriaNome ?? null,
    variacaoUsada: { codigo: variacao.codigo, cor: variacao.cor },
    anuncio,
  }
}

/** Imposto desconhecido de produto cadastrado: derivado no render para não envelhecer. */
function avisoImposto(estado: EstadoCalculadoraML, aliquotas: Aliquotas | undefined): string | null {
  const origem = estado.origemProduto
  if (origem === null || estado.entrada.aliquotaImpostoPct !== null) return null
  if (origem !== 'nacional' && origem !== 'importado') {
    return 'Imposto desconhecido: origem do produto não definida (nacional/importado). Informe o imposto.'
  }
  if (!aliquotas) return 'Imposto desconhecido: carregando as alíquotas da organização.'
  if (!aliquotas.confirmada) return 'Imposto desconhecido: alíquotas não confirmadas em Configurações. Informe o imposto.'
  return null
}

/**
 * Estado editável da calculadora. A cotação oficial é solicitada quando há preço e categoria;
 * até responder (ou ao falhar), o motor recebe a cotação manual e marca o resultado estimado.
 */
export function useCalculadoraML(opcoes: UseCalculadoraMLOptions = {}) {
  const [estado, dispatch] = useReducer(reducerCalculadora, opcoes, estadoInicialCalculadora)
  const { entrada, taxasManuais, tarifa } = estado
  const estadoRef = useRef(estado)
  estadoRef.current = estado
  const aliquotas = useAliquotas().data
  const aliquotasRef = useRef(aliquotas)
  aliquotasRef.current = aliquotas
  const selecaoRef = useRef(0)

  const produtos = useQuery({
    queryKey: QK.produtosEstoqueResumo,
    queryFn: fetchProdutosEstoqueResumo,
    staleTime: 5 * 60_000,
  })

  const cotacaoManual = useMemo(
    () => criarCotacaoManual(entrada.precoVenda, taxasManuais),
    [entrada.precoVenda, taxasManuais],
  )
  const cotacao: CotacoesPorModalidade = useMemo(
    () => tarifa ? cotacaoCalculadora(tarifa, taxasManuais) : cotacaoManual,
    [tarifa, taxasManuais, cotacaoManual],
  )
  // A meta do motor é sempre a solicitada (ou 0) — nunca a margem efetiva, que pode passar de 100%.
  const entradaMotor = useMemo(
    () => ({ ...entrada, margemAlvoPct: estado.metaSolicitada ?? 0 }),
    [entrada, estado.metaSolicitada],
  )
  const resultado = useMemo(
    () => calcularSimulacaoML(entradaMotor, cotacao, { semMeta: estado.metaSolicitada === null }),
    [entradaMotor, cotacao, estado.metaSolicitada],
  )
  const categoriaCotacao = entrada.categoriaId?.trim() || undefined
  const cotarEm = useMemo(
    () => criarCotarEm(categoriaCotacao, taxasManuais),
    [categoriaCotacao, taxasManuais],
  )
  const margemEfetiva = resultado.modalidades[estado.modalidade]?.margemPctExata ?? null
  const margemExibida = estado.metaStatus === 'calculando' ? estado.metaSolicitada : margemEfetiva

  const atualizarEntrada = useCallback((parcial: Partial<EntradaCalculadoraML>) => {
    dispatch({ type: 'EDITAR_ENTRADA', parcial })
  }, [])

  const editarPreco = useCallback((precoVenda: number) => {
    dispatch({ type: 'EDITAR_ENTRADA', parcial: { precoVenda } })
  }, [])

  const editarMargem = useCallback((meta: number) => {
    dispatch({ type: 'EDITAR_MARGEM', meta })
  }, [])

  const atualizarTaxasManuais = useCallback((parcial: Partial<TaxasManuaisML>) => {
    dispatch({ type: 'EDITAR_TAXAS', parcial })
  }, [])

  const setModalidadeAtiva = useCallback((modalidade: ModalidadeML) => {
    dispatch({ type: 'MODALIDADE', modalidade })
  }, [])

  const selecionarProduto = useCallback(async (produto: ProdutoCalculadoraML | null) => {
    const selecao = ++selecaoRef.current
    dispatch({ type: 'SELECIONAR', selecao, produto })
    const carregar = (carga: CargaProduto) => {
      dispatch({ type: 'PRODUTO_CARREGADO', selecao, carga, aliquotas: aliquotasRef.current })
    }
    if (!produto) return carregar(CARGA_VAZIA)

    let variacoes: VariacaoComSaldo[] | null
    try {
      variacoes = await fetchVariacoesProduto(produto.codigoPai)
    } catch {
      variacoes = null
    }
    if (selecaoRef.current !== selecao) return
    const variacao = variacoes && escolherVariacao(produto, variacoes)
    if (!variacao) {
      return carregar({
        ...CARGA_VAZIA,
        origem: produto.origem,
        avisos: [variacoes
          ? 'Produto sem variações cadastradas — preencha os campos à mão.'
          : 'Não foi possível carregar as variações do produto — preencha os campos à mão.'],
      })
    }

    let anuncio: AnuncioCalculadora | null
    try {
      anuncio = await fetchAnuncioCalculadora(produto.codigoPai, variacao.mlItemId)
    } catch {
      anuncio = null
    }
    if (selecaoRef.current !== selecao) return
    carregar(montarCarga(produto, variacao, anuncio))
  }, [])

  // Alíquota tardia (ação do sistema): preenche só se o operador não editou o imposto.
  useEffect(() => {
    if (aliquotas) dispatch({ type: 'ALIQUOTAS', aliquotas })
  }, [aliquotas])

  // Recota só quando a chave muda; a resposta vale se a chave atual ainda for a mesma.
  useEffect(() => {
    const chave = estado.chaveCotada
    const atual = estadoRef.current.entrada
    // Tarifa já presente na chave = o solver publicou preço + cotação juntos: não recotar.
    if (chave === null || estadoRef.current.tarifa || motivoSemCotacao(atual)) return
    const categoriaId = atual.categoriaId!.trim()
    const timer = window.setTimeout(() => {
      // Imposto fora da chave: só altera `recebe`, que o motor não usa. Desconhecido vai como 0
      // apenas para obter a tarifa — a simulação continua sem imposto confirmado.
      calcularTarifaML(atual.precoVenda, categoriaId, dimensoesDaTarifa(
        atual.dimensoes?.alturaCm, atual.dimensoes?.larguraCm, atual.dimensoes?.comprimentoCm, atual.dimensoes?.pesoKg,
      ), estadoRef.current.entrada.aliquotaImpostoPct ?? 0)
        .then((t) => dispatch({ type: 'COTACAO_RECEBIDA', chave, tarifa: t }))
        .catch(() => dispatch({ type: 'COTACAO_RECEBIDA', chave, tarifa: null }))
    }, DEBOUNCE_COTACAO_MS)
    return () => window.clearTimeout(timer)
  }, [estado.chaveCotada])

  // Solver (I3): debounce por revisão; entrada mudada pelo sistema (alíquotas) reinicia o cálculo.
  const calculando = estado.metaStatus === 'calculando'
  const revisaoSolver = calculando ? estado.revisao : null
  const entradaSolver = calculando ? estado.entrada : null
  useEffect(() => {
    if (revisaoSolver === null || entradaSolver === null) return
    const timer = window.setTimeout(() => {
      const atual = estadoRef.current
      const meta = atual.metaSolicitada ?? 0
      const modalidade = atual.modalidade
      const noSolver = { ...entradaSolver, margemAlvoPct: meta }
      const vigente = atual.tarifa
        ? cotacaoCalculadora(atual.tarifa, atual.taxasManuais)
        : criarCotacaoManual(entradaSolver.precoVenda, atual.taxasManuais)
      const inicial = normalizarCotacoes(noSolver, vigente)[modalidade]
      const tarifas = new Map<number, Tarifa>()
      const cotar = criarCotarEm(
        entradaSolver.categoriaId?.trim() || undefined,
        atual.taxasManuais,
        (preco, t) => tarifas.set(preco, t),
      )
      const publicar = (preco: number | null, confirmado: boolean) => dispatch({
        type: 'SOLVER_RESOLVIDO',
        revisao: revisaoSolver,
        entrada: entradaSolver,
        preco,
        tarifa: preco === null ? null : tarifas.get(preco) ?? null,
        confirmado,
      })
      if (!inicial) return publicar(null, false)
      precoPorMargem(noSolver, modalidade, meta, inicial, cotar)
        .then((r) => publicar(r?.preco ?? null, r?.confirmado ?? false))
        .catch(() => publicar(null, false))
    }, DEBOUNCE_MARGEM_MS)
    return () => window.clearTimeout(timer)
  }, [revisaoSolver, entradaSolver])

  const avisoDoImposto = avisoImposto(estado, aliquotas)
  const avisosProduto = useMemo(
    () => avisoDoImposto ? [...estado.avisosProduto, avisoDoImposto] : estado.avisosProduto,
    [estado.avisosProduto, avisoDoImposto],
  )

  return {
    entrada: entradaMotor,
    atualizarEntrada,
    editarPreco,
    editarMargem,
    cotarEm,
    metaSolicitada: estado.metaSolicitada,
    metaStatus: estado.metaStatus,
    ultimoEditado: estado.ultimoEditado,
    margemEfetiva,
    margemExibida,
    taxasManuais,
    atualizarTaxasManuais,
    produtoSelecionado: estado.produtoSelecionado,
    selecionarProduto,
    produtos,
    cotacao,
    statusCotacao: estado.statusCotacao,
    // Com tarifa aplicada, o aviso segue o frete manual atual; o state cobre idle/loading/falha.
    aviso: tarifa ? avisoDaTarifa(tarifa, taxasManuais) : estado.avisoApi,
    resultado,
    modalidadeAtiva: estado.modalidade,
    modalidadeDoAnuncio: estado.modalidadeDoAnuncio,
    setModalidadeAtiva,
    avisosProduto,
    categoriaNome: estado.categoriaNome,
    variacaoUsada: estado.variacaoUsada,
    anuncio: estado.anuncio,
  }
}
