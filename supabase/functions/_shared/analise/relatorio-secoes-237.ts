// Montagem pura das seções 2.6–2.9, 3.1–3.4 e 7.4 do relatório Análise PubliAI (ADR-0142).

import {
  calcularCoberturaEstimativa,
  calcularConcentracaoPorVendedor,
  calcularFaturamentoNichoTopN,
  calcularVendedoresSemEstimativa,
  calcularVolumeNicho,
  type AnuncioAmostra,
  type CoberturaEstimativa,
  type ConcentracaoPorVendedor,
  type FaturamentoNicho,
  type VendedoresSemEstimativa,
  type VolumeNicho,
} from '../pulse/nicho-vendedor.ts';
import type { SnapshotVendedor } from '../pulse/vendas-mensais-vendedor.ts';

export const PISO_NICHO_MES = 30_000;

/** Limitação registrada ADR-0142 D-1 / contrato §3.2 — loja inteira, não anúncio. */
export const LIMITACAO_3_2 =
  'O número de vendas/mês é da loja inteira do vendedor (janela móvel de 365 dias sobre transactions.total), não do anúncio analisado.';

export type PisoNicho = {
  valor: number;
  unidade: 'R$/mês';
  rotulo: string;
  tipo: 'regra_comercial';
};

export type MetaEntrada =
  | { valor: number; unidade: 'R$/mês'; rotulo: string }
  | { estado: 'sem_dado'; mensagem: string };

export type ParecerTamanhoNicho = { parecer: string };

export type Secoes237 = {
  '2.6': FaturamentoNicho;
  '2.7': PisoNicho;
  '2.8': MetaEntrada;
  '2.9': ParecerTamanhoNicho;
  '3.1': FaturamentoNicho;
  '3.2': VolumeNicho;
  '3.3': CoberturaEstimativa;
  '3.4': VendedoresSemEstimativa;
  limitacao_3_2: string;
  '7.4': ConcentracaoPorVendedor;
};

function calcularMetaEntrada(faturamento: FaturamentoNicho): MetaEntrada {
  if (faturamento.estado !== 'valor') {
    return { estado: 'sem_dado', mensagem: 'faturamento do nicho indisponível' };
  }
  return {
    valor: faturamento.faturamento_mes * 0.10,
    unidade: 'R$/mês',
    rotulo: 'meta de entrada (10% do faturamento do nicho)',
  };
}

function calcularParecerTamanho(faturamento: FaturamentoNicho): ParecerTamanhoNicho {
  if (faturamento.estado !== 'valor') {
    return { parecer: 'não dá para medir o tamanho deste nicho' };
  }
  return {
    parecer: faturamento.faturamento_mes >= PISO_NICHO_MES
      ? 'nicho comporta entrada'
      : 'nicho pequeno para a meta',
  };
}

/**
  * Agrega campos 2.6–2.9, 3.1–3.4 e 7.4 a partir da amostra + série pulse_vendedores.
  * `anunciosNaAmostra` é o total antes do descarte por seller_id ausente — denominador honesto
  * de 3.3 (spike 045).
  */
export function montarSecoes237(
  anuncios: AnuncioAmostra[],
  serie: SnapshotVendedor[],
  anunciosNaAmostra: number,
): Secoes237 {
  const faturamento = calcularFaturamentoNichoTopN(anuncios, serie);

  return {
    '2.6': faturamento,
    '2.7': {
      valor: PISO_NICHO_MES,
      unidade: 'R$/mês',
      rotulo: 'piso de nicho — regra comercial',
      tipo: 'regra_comercial',
    },
    '2.8': calcularMetaEntrada(faturamento),
    '2.9': calcularParecerTamanho(faturamento),
    '3.1': faturamento,
    '3.2': calcularVolumeNicho(anuncios, serie),
    '3.3': calcularCoberturaEstimativa(anuncios, serie, anunciosNaAmostra),
    '3.4': calcularVendedoresSemEstimativa(anuncios, serie),
    limitacao_3_2: LIMITACAO_3_2,
    '7.4': calcularConcentracaoPorVendedor(anuncios),
  };
}
