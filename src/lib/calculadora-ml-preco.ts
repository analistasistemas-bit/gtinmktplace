import {
  calcularSimulacaoML,
  normalizarCotacoes,
  type CotacoesPorModalidade,
  type CustosModalidadeML,
  type DimensoesProduto,
  type EntradaCalculadoraML,
  type ModalidadeML,
} from './calculadora-ml'

/** Kit de q unidades empilhadas: lado menor × q (empate: o primeiro em altura→largura→comprimento), peso × q. */
export function dimensoesDoKit(d: DimensoesProduto, q: number): DimensoesProduto {
  const lados = ['alturaCm', 'larguraCm', 'comprimentoCm'] as const
  const menor = lados.reduce((a, b) => (d[b] < d[a] ? b : a))
  return { ...d, [menor]: d[menor] * q, pesoKg: d.pesoKg * q }
}

/** Custo × q; custos fixos/variáveis/rebate são por kit (não multiplicam). */
export function entradaDoKit(e: EntradaCalculadoraML, q: number): EntradaCalculadoraML {
  return {
    ...e,
    custoProduto: e.custoProduto * q,
    dimensoes: e.dimensoes ? dimensoesDoKit(e.dimensoes, q) : undefined,
  }
}

export type CotarEm = (
  preco: number,
  entrada: EntradaCalculadoraML,
) => Promise<CotacoesPorModalidade>

export interface PrecoPorMargem {
  preco: number
  cotacao: CotacoesPorModalidade
  margemPct: number
  lucro: number
  confirmado: boolean
}

const TETO_SONDAGEM = 100_000
const centavos = (x: number) => Math.round(x * 100) / 100
// 1e-9: ruído de ponto flutuante (x*100 de um valor já em centavos não pode subir um centavo).
const ceilCentavos = (x: number) => centavos(Math.ceil(x * 100 - 1e-9) / 100)

/**
 * Menor preço (centavos) cuja margem, com a tarifa relida NAQUELE preço, atinge `metaPct`.
 * Padrão de `precoProprioEstavel` (supabase/functions/_shared/preco/sugerir.ts): itera o
 * gross-up até o ponto fixo; abaixo do ponto fixo avança centavos (arredondamento da comissão);
 * denominador ≤ 0 sonda a faixa seguinte dobrando o preço. Confirmado só se a cotação daquele
 * preço não é `estimated`. Nada atingiu → visitado de maior margem, não confirmado.
 * `cotarEm` falhou → devolve o menor seguro se houver, senão relança.
 */
export async function precoPorMargem(
  entrada: EntradaCalculadoraML,
  modalidade: ModalidadeML,
  metaPct: number,
  inicial: CustosModalidadeML,
  cotarEm: CotarEm,
  // ponytail: teto de chamadas à API por cálculo; ajustar se faixas reais exigirem mais avanços.
  maxChamadas = 12,
): Promise<PrecoPorMargem | null> {
  const imposto = entrada.aliquotaImpostoPct
  if (imposto === null) return null
  const fixos = entrada.custoProduto + entrada.custosFixos + entrada.custosVariaveis - entrada.rebate
  const baseInicial = centavos(fixos + inicial.taxaFixa + (inicial.frete ?? 0))
  if (baseInicial <= 0) return null

  /** null = denominador ≤ 0 (meta inatingível nesta faixa). */
  const candidato = (c: CustosModalidadeML): number | null => {
    const base = centavos(fixos + c.taxaFixa + (c.frete ?? 0))
    const den = 1 - (c.percentualComissaoPct + imposto) / 100 - metaPct / 100
    return den > 0 ? ceilCentavos(base / den) : null
  }

  const visitados = new Map<number, PrecoPorMargem>()
  const atingem: PrecoPorMargem[] = []
  let p = candidato(inicial) ?? centavos(Math.max(baseInicial, 1) * 2)

  for (let i = 0; i < maxChamadas && p <= TETO_SONDAGEM; i++) {
    let cotacao: CotacoesPorModalidade
    try {
      cotacao = await cotarEm(p, entrada)
    } catch (e) {
      if (atingem.length) break
      throw e
    }
    const noPreco = { ...entrada, precoVenda: p }
    const r = calcularSimulacaoML(noPreco, cotacao).modalidades[modalidade]
    const custos = normalizarCotacoes(noPreco, cotacao)[modalidade]
    if (!r || !custos) return null // frete null / dados faltando

    const atingeMeta = r.margemPctExata >= metaPct - 1e-9
    const confirmavel = r.proveniencia !== 'estimated'
    const v: PrecoPorMargem = {
      preco: p,
      cotacao,
      margemPct: r.margemPctExata,
      lucro: r.lucro,
      confirmado: atingeMeta && confirmavel,
    }
    visitados.set(p, v)
    if (atingeMeta) atingem.push(v)
    if (atingeMeta && !confirmavel) break // cotação que nunca confirma: não gastar chamadas

    let proximo = candidato(custos)
    if (proximo === null) proximo = centavos(p * 2) // sondar a faixa seguinte
    else if (!atingeMeta && (proximo <= p || visitados.has(proximo))) proximo = centavos(p + 0.01)
    if (atingeMeta && (proximo >= p || visitados.has(proximo))) break
    p = proximo
  }

  if (atingem.length) return atingem.reduce((a, b) => (b.preco < a.preco ? b : a))
  return [...visitados.values()].reduce<PrecoPorMargem | null>(
    (a, b) => (a === null || b.margemPct > a.margemPct ? b : a),
    null,
  )
}
