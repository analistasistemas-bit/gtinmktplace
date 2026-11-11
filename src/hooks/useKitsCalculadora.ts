import { useEffect, useState } from 'react'
import {
  calcularSimulacaoML,
  normalizarCotacoes,
  type CotacoesPorModalidade,
  type CustosModalidadeML,
  type EntradaCalculadoraML,
  type ModalidadeML,
  type ResultadoModalidadeML,
} from '@/lib/calculadora-ml'
import { entradaDoKit, precoPorMargem, type CotarEm } from '@/lib/calculadora-ml-preco'

const DEBOUNCE_KITS_MS = 400

export interface ColunaKit {
  quantidade: number
  /** Custo do produto no kit (custo × quantidade); sempre conhecido. */
  custo: number
  preco: number | null
  precoUnitario: number | null
  frete: number | null
  comissao: number | null
  lucro: number | null
  margemPct: number | null
  status: 'ok' | 'calculando' | 'nao_confirmado' | 'sem_dados'
}

export interface UseKitsCalculadoraArgs {
  entrada: EntradaCalculadoraML
  modalidade: ModalidadeML
  margemPct: number | null
  quantidadeN: number
  resultadoUnidade: ResultadoModalidadeML | null
  cotarEm: CotarEm
  aguardando: boolean
}

const vazia = (quantidade: number, custo: number, status: ColunaKit['status']): ColunaKit => ({
  quantidade, custo, preco: null, precoUnitario: null, frete: null, comissao: null, lucro: null, margemPct: null, status,
})

/** Frete do kit só vale de tarifa `official`: o frete manual da unidade nunca é herdado. */
function semFreteNaoOficial(c: CotacoesPorModalidade): CotacoesPorModalidade {
  const limpar = (m: CustosModalidadeML) => (m.proveniencia === 'official' ? m : { ...m, frete: null })
  if (c.origem === 'manual') return { origem: 'manual', classico: { ...c.classico, frete: null } }
  return { ...c, classico: limpar(c.classico), premium: limpar(c.premium) }
}

async function calcularColuna(
  entrada: EntradaCalculadoraML,
  modalidade: ModalidadeML,
  margemPct: number,
  q: number,
  cotarEm: CotarEm,
): Promise<ColunaKit> {
  const kit = entradaDoKit(entrada, q)
  const naoConfirmada = vazia(q, kit.custoProduto, 'nao_confirmado')
  // Cache por preço: a sondagem inicial não é cotada de novo se o solver cair no mesmo preço.
  const cache = new Map<number, Promise<CotacoesPorModalidade>>()
  const cotarKit: CotarEm = (preco, e) => {
    if (!cache.has(preco)) cache.set(preco, cotarEm(preco, e).then(semFreteNaoOficial))
    return cache.get(preco)!
  }
  try {
    // ponytail: ponto de partida = preço da unidade × q; o solver relê a tarifa no preço final.
    const p0 = Math.max(Math.round(entrada.precoVenda * q * 100) / 100, 1)
    const inicial = normalizarCotacoes({ ...kit, precoVenda: p0 }, await cotarKit(p0, kit))[modalidade]
    if (!inicial || inicial.frete === null) return naoConfirmada
    const r = await precoPorMargem(kit, modalidade, margemPct, inicial, cotarKit)
    if (!r) return naoConfirmada
    const m = calcularSimulacaoML({ ...kit, precoVenda: r.preco }, r.cotacao, { semMeta: true }).modalidades[modalidade]
    if (!m) return naoConfirmada
    return {
      quantidade: q,
      custo: kit.custoProduto,
      preco: r.preco,
      precoUnitario: r.preco / q,
      frete: m.custos.frete,
      comissao: m.custos.comissao,
      lucro: m.lucro,
      margemPct: m.margemPctExata,
      status: r.confirmado ? 'ok' : 'nao_confirmado',
    }
  } catch {
    return naoConfirmada
  }
}

/**
 * Quadro de kits 1 · 2 · 3 · N mantendo a margem atual da modalidade ativa. Coluna 1 = resultado
 * da tela; colunas ≥ 2 cotam preço e medidas do kit (debounce, em paralelo, só a última rodada publica).
 */
export function useKitsCalculadora({
  entrada, modalidade, margemPct, quantidadeN, resultadoUnidade, cotarEm, aguardando,
}: UseKitsCalculadoraArgs): ColunaKit[] {
  const quantidades = [1, 2, 3, ...([1, 2, 3].includes(quantidadeN) ? [] : [quantidadeN])]
  const kits = quantidades.slice(1)
  const semDados = !entrada.categoriaId?.trim() || !entrada.dimensoes ||
    entrada.aliquotaImpostoPct === null || margemPct === null
  const cotar = !aguardando && !semDados
  // Effect chaveado por valores: objeto novo com os mesmos números não recota.
  const chave = cotar ? JSON.stringify([entrada, modalidade, margemPct, kits]) : null
  const [publicado, setPublicado] = useState<{ chave: string; cotarEm: CotarEm; colunas: ColunaKit[] } | null>(null)

  useEffect(() => {
    if (chave === null) return
    const [e, mod, meta, qs] = JSON.parse(chave) as [EntradaCalculadoraML, ModalidadeML, number, number[]]
    let vigente = true
    const timer = window.setTimeout(() => {
      Promise.all(qs.map((q) => calcularColuna(e, mod, meta, q, cotarEm)))
        .then((colunas) => { if (vigente) setPublicado({ chave, cotarEm, colunas }) })
    }, DEBOUNCE_KITS_MS)
    return () => { vigente = false; window.clearTimeout(timer) }
  }, [chave, cotarEm])

  const unidade: ColunaKit = resultadoUnidade
    ? {
        quantidade: 1,
        custo: entrada.custoProduto,
        preco: entrada.precoVenda,
        precoUnitario: entrada.precoVenda,
        frete: resultadoUnidade.custos.frete,
        comissao: resultadoUnidade.custos.comissao,
        lucro: resultadoUnidade.lucro,
        margemPct: resultadoUnidade.margemPctExata,
        status: resultadoUnidade.proveniencia === 'estimated' ? 'nao_confirmado' : 'ok',
      }
    : vazia(1, entrada.custoProduto, 'sem_dados')

  const demais = kits.map((q) => {
    const custo = entrada.custoProduto * q
    if (aguardando) return vazia(q, custo, 'calculando')
    if (semDados) return vazia(q, custo, 'sem_dados')
    if (publicado?.chave !== chave || publicado.cotarEm !== cotarEm) return vazia(q, custo, 'calculando')
    return publicado.colunas.find((c) => c.quantidade === q) ?? vazia(q, custo, 'calculando')
  })
  return [unidade, ...demais]
}
