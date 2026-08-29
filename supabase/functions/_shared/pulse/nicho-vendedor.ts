// Agregações de nicho por vendedor (ADR-0142 + ADR-0143): campos 3.2, 3.3, 3.4 e 7.4 do contrato.
// Função pura — sem I/O. A ponte da amostra para o vendedor é o CATÁLOGO (ADR-0143 D-1): estas
// funções recebem os vendedores já resolvidos, não os deduzem do item_id.
//
// 2.6/2.8/3.1 não existem mais: o faturamento do nicho saiu do ar (ADR-0143 D-3) porque somar
// `vendas_mes` da loja inteira × preço de um anúncio do nicho produziu R$ 187,2 mi com 94,5%
// vindos de uma única conta institucional. Ausência declarada > precisão falsa.

import {
  estimarVendasMensais,
  medianaVendasMensaisDoUniverso,
  normalizarSellerId,
  type SnapshotVendedor,
  type VendasMensais,
} from './vendas-mensais-vendedor.ts';

export type AnuncioAmostra = {
  item_id: string;
  seller_id: string | number;
  preco: number | null;
  /** Acumulado Apify — usado só por 7.4 (concentração por anúncio da amostra). */
  vendidos: number | null;
};

export type CampoComEstado<V> =
  | ({ estado: 'valor' } & V)
  | { estado: 'sem_dado'; mensagem: string };

export type VolumeNicho = CampoComEstado<{
  vendas_mes_mediana: number;
  vendedores_com_estimativa: number;
  rotulo: string;
}>;

export type CoberturaEstimativa = {
  com_estimativa: number;
  vendedores_distintos: number;
  proporcao: number | null;
  /** Total de anúncios da amostra, inclusive os sem catálogo (spike 045). */
  anuncios_na_amostra: number;
  /** Anúncios com `catalog_product_id` — os únicos com ponte para o vendedor (ADR-0143 D-1). */
  anuncios_com_catalogo: number;
  proporcao_anuncios: number | null;
  rotulo: string;
};

export type VendedoresSemEstimativa = {
  contagem: number;
  rotulo: string;
};

export type ConcentracaoPorVendedor = {
  elegiveis: number;
  vendedores_distintos: number;
  top1: number;
  corte: number;
  dominante: boolean;
  rotulo: string;
} | null;

const MIN_ELEGIVEIS_CONCENTRACAO = 5;
// Spike 045: com 1 vendedor a mediana é esse vendedor. Mesmo piso de 7.3/7.4.
const MIN_VENDEDORES_NICHO = 5;

/** Rótulo obrigatório da ADR-0143 D-2 — o conjunto NÃO é "vendedores da amostra". */
export const UNIDADE_VENDEDOR =
  'vendedores que disputam os catálogos desta amostra (vendas/mês da loja inteira, janela 365d)';

function distintos(sellerIds: Array<string | number>): Set<string> {
  return new Set(sellerIds.map(normalizarSellerId));
}

function contarComEstimativa(ids: Set<string>, estimativas: Map<string, VendasMensais>): number {
  let n = 0;
  for (const id of ids) if (estimativas.get(id)?.estado === 'valor') n++;
  return n;
}

/** 3.2 — mediana de vendas_mes entre os vendedores do catálogo com estado valor (D-6 da 0142). */
export function calcularVolumeNicho(
  sellerIds: Array<string | number>,
  serieVendedores: SnapshotVendedor[],
): VolumeNicho {
  const ids = distintos(sellerIds);
  const estimativas = estimarVendasMensais(serieVendedores);

  const subset = new Map<string, VendasMensais>();
  for (const id of ids) {
    const est = estimativas.get(id);
    if (est) subset.set(id, est);
  }

  const mediana = medianaVendasMensaisDoUniverso(subset);
  const comEstimativa = contarComEstimativa(ids, estimativas);

  if (mediana == null || comEstimativa === 0) {
    return { estado: 'sem_dado', mensagem: 'não dá para estimar o volume deste nicho' };
  }

  if (comEstimativa < MIN_VENDEDORES_NICHO) {
    return {
      estado: 'sem_dado',
      mensagem: `amostra insuficiente: ${comEstimativa} de ${MIN_VENDEDORES_NICHO} vendedores mínimos com estimativa mensal`,
    };
  }

  return {
    estado: 'valor',
    vendas_mes_mediana: mediana,
    vendedores_com_estimativa: comEstimativa,
    rotulo: `mediana de vendas/mês — ${UNIDADE_VENDEDOR} (${comEstimativa} vendedores)`,
  };
}

/**
 * 3.3 — cobertura em duas unidades. `anunciosNaAmostra` é o total da amostra e
 * `anunciosComCatalogo` os que têm ponte para o vendedor: sem esse par o operador lê 3.2 como se
 * cobrisse o nicho inteiro (spike 045, onde a razão de sobreviventes exibia 100%).
 */
export function calcularCoberturaEstimativa(
  sellerIds: Array<string | number>,
  serieVendedores: SnapshotVendedor[],
  anunciosNaAmostra: number,
  anunciosComCatalogo: number,
): CoberturaEstimativa {
  const ids = distintos(sellerIds);
  const estimativas = estimarVendasMensais(serieVendedores);
  const comEstimativa = contarComEstimativa(ids, estimativas);

  const rotuloAnuncios = anunciosNaAmostra > 0
    ? `${anunciosComCatalogo} de ${anunciosNaAmostra} anúncios da amostra têm catálogo`
    : '0 anúncios na amostra';
  const rotuloVendedores = ids.size > 0
    ? ` — ${comEstimativa} de ${ids.size} vendedores com estimativa mensal`
    : '';

  return {
    com_estimativa: comEstimativa,
    vendedores_distintos: ids.size,
    proporcao: ids.size > 0 ? comEstimativa / ids.size : null,
    anuncios_na_amostra: anunciosNaAmostra,
    anuncios_com_catalogo: anunciosComCatalogo,
    proporcao_anuncios: anunciosNaAmostra > 0 ? anunciosComCatalogo / anunciosNaAmostra : null,
    rotulo: rotuloAnuncios + rotuloVendedores,
  };
}

/** 3.4 — vendedores em serie_insuficiente, sem_estimativa_no_periodo ou sem série alguma. */
export function calcularVendedoresSemEstimativa(
  sellerIds: Array<string | number>,
  serieVendedores: SnapshotVendedor[],
): VendedoresSemEstimativa {
  const ids = distintos(sellerIds);
  const estimativas = estimarVendasMensais(serieVendedores);
  let sem = 0;

  for (const id of ids) {
    const est = estimativas.get(id);
    if (
      est == null
      || est.estado === 'serie_insuficiente'
      || est.estado === 'sem_estimativa_no_periodo'
    ) {
      sem++;
    }
  }

  return {
    contagem: sem,
    rotulo: `${sem} vendedor${sem === 1 ? '' : 'es'} sem estimativa mensal`,
  };
}

/** Agrupa anúncios da amostra por seller_id normalizado (7.4). */
export function agruparAnunciosPorVendedor(
  anuncios: AnuncioAmostra[],
): Map<string, AnuncioAmostra[]> {
  const porVendedor = new Map<string, AnuncioAmostra[]>();
  for (const a of anuncios) {
    const id = normalizarSellerId(a.seller_id);
    const bucket = porVendedor.get(id);
    if (bucket) bucket.push(a);
    else porVendedor.set(id, [a]);
  }
  return porVendedor;
}

/**
 * 7.4 — concentração por seller_id sobre os ANÚNCIOS da amostra (share ADR-0137). Continua na
 * unidade anúncio, sem mudança: a ADR-0143 D-2 restringe só 3.2/3.3/3.4.
 */
export function calcularConcentracaoPorVendedor(anuncios: AnuncioAmostra[]): ConcentracaoPorVendedor {
  const porVendedor = agruparAnunciosPorVendedor(anuncios);
  const faturamentos: number[] = [];

  for (const anunciosDoVendedor of porVendedor.values()) {
    let soma = 0;
    let temElegivel = false;
    for (const a of anunciosDoVendedor) {
      if (a.vendidos != null && a.preco != null) {
        soma += a.vendidos * a.preco;
        temElegivel = true;
      }
    }
    if (temElegivel) faturamentos.push(soma);
  }

  if (faturamentos.length < MIN_ELEGIVEIS_CONCENTRACAO) return null;

  const total = faturamentos.reduce((a, f) => a + f, 0);
  if (total <= 0) return null;

  const top1 = Math.max(...faturamentos) / total;
  const corte = Math.max(0.3, 2 / faturamentos.length);

  return {
    elegiveis: faturamentos.length,
    vendedores_distintos: porVendedor.size,
    top1,
    corte,
    dominante: top1 >= corte,
    rotulo: `concentração por vendedor — ${faturamentos.length} com venda registrada na amostra`,
  };
}
