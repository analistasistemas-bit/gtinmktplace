// Montagem pura dos campos 2.9, 3.2, 3.3, 3.4 e 7.4 do relatório Análise PubliAI
// (ADR-0142 + ADR-0143).
//
// 2.6, 2.7, 2.8 e 3.1 não existem mais no payload: o faturamento do nicho saiu do ar (ADR-0143
// D-3). Sob a ponte do catálogo ele daria R$ 187,2 mi/mês com 94,5% vindos de uma única conta
// institucional, e o piso de 5 vendedores — que era um proxy — deixa de disparar com 102.
// 2.9 permanece apenas como ausência declarada, porque a seção 2 promete o campo.

import {
  calcularCoberturaEstimativa,
  calcularConcentracaoPorVendedor,
  calcularVendedoresSemEstimativa,
  calcularVolumeNicho,
  type AnuncioAmostra,
  type CoberturaEstimativa,
  type ConcentracaoPorVendedor,
  type VendedoresSemEstimativa,
  type VolumeNicho,
} from '../pulse/nicho-vendedor.ts';
import type { SnapshotVendedor } from '../pulse/vendas-mensais-vendedor.ts';

/** Limitação registrada ADR-0142 D-1 / ADR-0143 D-2 — loja inteira, e do catálogo, não do anúncio. */
export const LIMITACAO_3_2 =
  'As vendas/mês são da loja inteira do vendedor (janela móvel de 365 dias sobre transactions.total), '
  + 'e o conjunto são os vendedores que disputam os catálogos desta amostra — não os anúncios listados.';

/** ADR-0143 D-3: não é ausência de dado, é decisão de não publicar precisão falsa. */
export const MOTIVO_SEM_FATURAMENTO =
  'o faturamento do nicho não é publicado: a estimativa por vendedor é da loja inteira, não do anúncio (ADR-0143)';

export type ParecerTamanhoNicho = { estado: 'sem_dado'; mensagem: string };

export type Secoes237 = {
  '2.9': ParecerTamanhoNicho;
  '3.2': VolumeNicho;
  '3.3': CoberturaEstimativa;
  '3.4': VendedoresSemEstimativa;
  limitacao_3_2: string;
  '7.4': ConcentracaoPorVendedor;
};

export type EntradaSecoes237 = {
  /** Anúncios da amostra com seller_id resolvido — usados só por 7.4. */
  anuncios: AnuncioAmostra[];
  /** Total de anúncios da amostra, antes de qualquer descarte. */
  anunciosNaAmostra: number;
  /** Quantos deles têm `catalog_product_id` — os únicos com ponte para o vendedor. */
  anunciosComCatalogo: number;
  /** Vendedores dos catálogos representados na amostra (ADR-0143 D-1). */
  sellerIdsCatalogo: Array<string | number>;
  serie: SnapshotVendedor[];
};

export function montarSecoes237(e: EntradaSecoes237): Secoes237 {
  return {
    '2.9': { estado: 'sem_dado', mensagem: MOTIVO_SEM_FATURAMENTO },
    '3.2': calcularVolumeNicho(e.sellerIdsCatalogo, e.serie),
    '3.3': calcularCoberturaEstimativa(
      e.sellerIdsCatalogo,
      e.serie,
      e.anunciosNaAmostra,
      e.anunciosComCatalogo,
    ),
    '3.4': calcularVendedoresSemEstimativa(e.sellerIdsCatalogo, e.serie),
    limitacao_3_2: LIMITACAO_3_2,
    '7.4': calcularConcentracaoPorVendedor(e.anuncios),
  };
}
