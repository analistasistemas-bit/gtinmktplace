export interface DimensoesProduto {
  alturaCm: number
  larguraCm: number
  comprimentoCm: number
  pesoKg: number
}

export interface PesoUtilizado {
  pesoCubadoKg: number
  pesoUtilizadoKg: number
}

export type ModalidadeML = 'classico' | 'premium'

export type Proveniencia = 'official' | 'partial' | 'estimated'

export interface EntradaCalculadoraML {
  precoVenda: number
  custoProduto: number
  aliquotaImpostoPct: number
  custosFixos: number
  custosVariaveis: number
  rebate: number
  margemAlvoPct: number
  dimensoes?: DimensoesProduto
  modalidadeParaDecisao?: ModalidadeML
}

export interface CustosModalidadeML {
  percentualComissaoPct: number
  taxaFixa: number
  comissaoTotal: number
  frete: number | null
  proveniencia: Proveniencia
}

export interface CotacoesPorModalidade {
  classico: CustosModalidadeML
  premium: CustosModalidadeML
}

export interface DecomposicaoCustosML {
  custoProduto: number
  comissao: number
  frete: number
  imposto: number
  custosFixos: number
  custosVariaveis: number
  rebate: number
  total: number
}

export interface PrecoProjetadoML {
  valor: number | null
  proveniencia: 'estimated'
  ehProjecao: true
}

export interface ResultadoModalidadeML {
  proveniencia: Proveniencia
  custos: DecomposicaoCustosML
  lucro: number
  margemPct: number
  precoEquilibrio: PrecoProjetadoML
  precoAlvo: PrecoProjetadoML
  custoMaximoCompra: number
}

export type TipoVereditoML =
  | 'Comprar'
  | 'Negociar custo'
  | 'Ajustar preço'
  | 'Evitar'
  | 'Dados insuficientes'

export interface VereditoML {
  tipo: TipoVereditoML
  fatores: string[]
}

export interface ResultadoCalculadoraML {
  peso: PesoUtilizado | null
  modalidades: Record<ModalidadeML, ResultadoModalidadeML | null>
  veredito: VereditoML
}

export function calcularPesoUtilizado(
  dimensoes?: DimensoesProduto,
): PesoUtilizado | null {
  if (!dimensoes) return null

  validarPositivo('alturaCm', dimensoes.alturaCm)
  validarPositivo('larguraCm', dimensoes.larguraCm)
  validarPositivo('comprimentoCm', dimensoes.comprimentoCm)
  validarPositivo('pesoKg', dimensoes.pesoKg)

  const pesoCubadoKg =
    (dimensoes.alturaCm * dimensoes.larguraCm * dimensoes.comprimentoCm) / 6000

  return {
    pesoCubadoKg,
    pesoUtilizadoKg: Math.max(dimensoes.pesoKg, pesoCubadoKg),
  }
}

export function calcularSimulacaoML(
  entrada: EntradaCalculadoraML,
  cotacoes?: CotacoesPorModalidade,
): ResultadoCalculadoraML {
  validarEntrada(entrada)

  const peso = calcularPesoUtilizado(entrada.dimensoes)
  const modalidades: ResultadoCalculadoraML['modalidades'] = {
    classico: calcularModalidade(entrada, cotacoes?.classico),
    premium: calcularModalidade(entrada, cotacoes?.premium),
  }
  const modalidadeParaDecisao = entrada.modalidadeParaDecisao ?? 'classico'

  return {
    peso,
    modalidades,
    veredito: calcularVeredito(
      entrada,
      modalidades[modalidadeParaDecisao],
    ),
  }
}

function calcularModalidade(
  entrada: EntradaCalculadoraML,
  cotacao?: CustosModalidadeML,
): ResultadoModalidadeML | null {
  if (!cotacao) return null
  validarCotacao(cotacao)
  if (entrada.precoVenda === 0 || cotacao.frete === null) return null

  const imposto = arredondarMoeda(
    (entrada.precoVenda * entrada.aliquotaImpostoPct) / 100,
  )
  const total = arredondarMoeda(
    entrada.custoProduto +
      cotacao.comissaoTotal +
      cotacao.frete +
      imposto +
      entrada.custosFixos +
      entrada.custosVariaveis -
      entrada.rebate,
  )
  const lucro = arredondarMoeda(entrada.precoVenda - total)
  const margemPct = arredondarMoeda((lucro / entrada.precoVenda) * 100)
  const basePreco =
    entrada.custoProduto +
    cotacao.taxaFixa +
    cotacao.frete +
    entrada.custosFixos +
    entrada.custosVariaveis -
    entrada.rebate
  const percentualCusto =
    (cotacao.percentualComissaoPct + entrada.aliquotaImpostoPct) / 100
  const custoMaximoCompra = arredondarMoeda(
    entrada.precoVenda -
      cotacao.comissaoTotal -
      cotacao.frete -
      imposto -
      entrada.custosFixos -
      entrada.custosVariaveis +
      entrada.rebate -
      (entrada.precoVenda * entrada.margemAlvoPct) / 100,
  )

  return {
    proveniencia: cotacao.proveniencia,
    custos: {
      custoProduto: entrada.custoProduto,
      comissao: cotacao.comissaoTotal,
      frete: cotacao.frete,
      imposto,
      custosFixos: entrada.custosFixos,
      custosVariaveis: entrada.custosVariaveis,
      rebate: entrada.rebate,
      total,
    },
    lucro,
    margemPct,
    precoEquilibrio: criarPrecoProjetado(basePreco, percentualCusto, 0),
    precoAlvo: criarPrecoProjetado(
      basePreco,
      percentualCusto,
      entrada.margemAlvoPct,
    ),
    custoMaximoCompra,
  }
}

function calcularVeredito(
  entrada: EntradaCalculadoraML,
  resultado: ResultadoModalidadeML | null,
): VereditoML {
  if (entrada.precoVenda === 0 || !resultado) {
    return {
      tipo: 'Dados insuficientes',
      fatores: [
        'Informe preço, custo e uma cotação com frete calculado para decidir.',
      ],
    }
  }

  if (resultado.margemPct >= entrada.margemAlvoPct && resultado.lucro > 0) {
    return {
      tipo: 'Comprar',
      fatores: [
        `Margem atual de ${formatarPct(resultado.margemPct)} atinge a meta de ${formatarPct(entrada.margemAlvoPct)}.`,
        `Lucro estimado de ${formatarMoeda(resultado.lucro)} por unidade.`,
      ],
    }
  }

  if (
    resultado.custoMaximoCompra >= 0 &&
    resultado.custoMaximoCompra < entrada.custoProduto
  ) {
    return {
      tipo: 'Negociar custo',
      fatores: [
        `Margem atual de ${formatarPct(resultado.margemPct)} fica abaixo da meta de ${formatarPct(entrada.margemAlvoPct)}.`,
        `Negocie o custo de ${formatarMoeda(entrada.custoProduto)} para até ${formatarMoeda(resultado.custoMaximoCompra)}.`,
        resultado.precoAlvo.valor === null
          ? 'A margem desejada não admite preço projetado com a estrutura atual.'
          : `Preço projetado de ${formatarMoeda(resultado.precoAlvo.valor)} deve ser validado na API.`,
      ],
    }
  }

  if (resultado.precoAlvo.valor !== null) {
    return {
      tipo: 'Ajustar preço',
      fatores: [
        `Margem atual de ${formatarPct(resultado.margemPct)} fica abaixo da meta de ${formatarPct(entrada.margemAlvoPct)}.`,
        `Projete ${formatarMoeda(resultado.precoAlvo.valor)} para buscar a meta; valide na API.`,
      ],
    }
  }

  return {
    tipo: 'Evitar',
    fatores: [
      `A meta de ${formatarPct(entrada.margemAlvoPct)} não comporta preço projetado com os custos atuais.`,
      `Lucro atual de ${formatarMoeda(resultado.lucro)} por unidade.`,
    ],
  }
}

function criarPrecoProjetado(
  basePreco: number,
  percentualCusto: number,
  margemAlvoPct: number,
): PrecoProjetadoML {
  const denominador = 1 - percentualCusto - margemAlvoPct / 100

  return {
    valor: denominador > 0 ? basePreco / denominador : null,
    proveniencia: 'estimated',
    ehProjecao: true,
  }
}

function validarEntrada(entrada: EntradaCalculadoraML): void {
  validarNaoNegativo('precoVenda', entrada.precoVenda)
  validarNaoNegativo('custoProduto', entrada.custoProduto)
  validarPercentual('aliquotaImpostoPct', entrada.aliquotaImpostoPct)
  validarNaoNegativo('custosFixos', entrada.custosFixos)
  validarNaoNegativo('custosVariaveis', entrada.custosVariaveis)
  validarNaoNegativo('rebate', entrada.rebate)
  validarPercentual('margemAlvoPct', entrada.margemAlvoPct)
}

function validarCotacao(cotacao: CustosModalidadeML): void {
  validarPercentual('percentualComissaoPct', cotacao.percentualComissaoPct)
  validarNaoNegativo('taxaFixa', cotacao.taxaFixa)
  validarNaoNegativo('comissaoTotal', cotacao.comissaoTotal)
  if (cotacao.frete !== null) validarNaoNegativo('frete', cotacao.frete)
}

function validarPercentual(nome: string, valor: number): void {
  validarNaoNegativo(nome, valor)
  if (valor > 100) throw new RangeError(`${nome} deve estar entre 0 e 100.`)
}

function validarPositivo(nome: string, valor: number): void {
  validarNaoNegativo(nome, valor)
  if (valor === 0) throw new RangeError(`${nome} deve ser maior que zero.`)
}

function validarNaoNegativo(nome: string, valor: number): void {
  if (!Number.isFinite(valor) || valor < 0) {
    throw new RangeError(`${nome} deve ser um número finito não negativo.`)
  }
}

function arredondarMoeda(valor: number): number {
  return Number(valor.toFixed(2))
}

function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

function formatarPct(valor: number): string {
  return `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`
}
