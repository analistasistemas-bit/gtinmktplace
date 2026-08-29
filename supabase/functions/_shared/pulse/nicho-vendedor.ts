// Agregações de nicho por vendedor (ADR-0142): campos 2.6, 3.1–3.4 e 7.4 do contrato.
// Função pura — sem I/O. Usa estimarVendasMensais + medianaVendasMensaisDoUniverso.

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
  /** Acumulado Apify — só para preço representativo e 7.4. */
  vendidos: number | null;
};

export type CampoComEstado<T extends string, V = never> =
  | ({ estado: 'valor' } & V)
  | { estado: 'sem_dado'; mensagem: string };

export type FaturamentoNicho = CampoComEstado<
  'valor',
  {
    faturamento_mes: number;
    vendedores_com_estimativa: number;
    vendedores_distintos: number;
    rotulo: string;
  }
>;

export type VolumeNicho = CampoComEstado<
  'valor',
  {
    vendas_mes_mediana: number;
    vendedores_com_estimativa: number;
    rotulo: string;
  }
>;

export type CoberturaEstimativa = {
  com_estimativa: number;
  vendedores_distintos: number;
  proporcao: number | null;
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
const TOP1_DOMINANTE = 0.3;

/** Agrupa anúncios da amostra por seller_id normalizado. */
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

/** Preço representativo do vendedor na amostra (contrato 2.6). */
export function precoRepresentativo(anunciosDoVendedor: AnuncioAmostra[]): number | null {
  let melhorScore = -1;
  let precoMelhorScore: number | null = null;
  let maiorPreco: number | null = null;

  for (const a of anunciosDoVendedor) {
    if (a.preco == null) continue;
    if (maiorPreco == null || a.preco > maiorPreco) maiorPreco = a.preco;
    if (a.vendidos != null) {
      const score = a.vendidos * a.preco;
      if (score > melhorScore) {
        melhorScore = score;
        precoMelhorScore = a.preco;
      }
    }
  }

  return precoMelhorScore ?? maiorPreco;
}

function vendedoresDistintos(anuncios: AnuncioAmostra[]): Set<string> {
  return new Set(anuncios.map((a) => normalizarSellerId(a.seller_id)));
}

function estimativasNaAmostra(
  anuncios: AnuncioAmostra[],
  serieVendedores: SnapshotVendedor[],
): {
  distintos: Set<string>;
  porVendedor: Map<string, AnuncioAmostra[]>;
  estimativas: Map<string, VendasMensais>;
} {
  const porVendedor = agruparAnunciosPorVendedor(anuncios);
  const distintos = vendedoresDistintos(anuncios);
  const estimativas = estimarVendasMensais(serieVendedores);
  return { distintos, porVendedor, estimativas };
}

function contarComEstimativa(
  distintos: Set<string>,
  estimativas: Map<string, VendasMensais>,
): number {
  let n = 0;
  for (const id of distintos) {
    if (estimativas.get(id)?.estado === 'valor') n++;
  }
  return n;
}

/** 2.6 / 3.1 — soma de vendas_mes × preço representativo por vendedor com estimativa. */
export function calcularFaturamentoNichoTopN(
  anuncios: AnuncioAmostra[],
  serieVendedores: SnapshotVendedor[],
): FaturamentoNicho {
  const { distintos, porVendedor, estimativas } = estimativasNaAmostra(anuncios, serieVendedores);
  const totalDistintos = distintos.size;

  if (totalDistintos === 0) {
    return {
      estado: 'sem_dado',
      mensagem: 'nenhum vendedor na amostra',
    };
  }

  let faturamento = 0;
  let comEstimativa = 0;

  for (const sellerId of distintos) {
    const est = estimativas.get(sellerId);
    if (est?.estado !== 'valor') continue;
    const preco = precoRepresentativo(porVendedor.get(sellerId) ?? []);
    if (preco == null) continue;
    faturamento += est.vendas_mes * preco;
    comEstimativa++;
  }

  if (comEstimativa === 0) {
    return {
      estado: 'sem_dado',
      mensagem: 'nenhum vendedor da amostra tem estimativa mensal',
    };
  }

  return {
    estado: 'valor',
    faturamento_mes: faturamento,
    vendedores_com_estimativa: comEstimativa,
    vendedores_distintos: totalDistintos,
    rotulo: `faturamento de ${comEstimativa} vendedor${comEstimativa === 1 ? '' : 'es'} com estimativa (vendas/mês — loja inteira, janela 365d)`,
  };
}

/** 3.2 — mediana de vendas_mes entre vendedores com estado valor (D-6). */
export function calcularVolumeNicho(
  anuncios: AnuncioAmostra[],
  serieVendedores: SnapshotVendedor[],
): VolumeNicho {
  const { distintos, estimativas } = estimativasNaAmostra(anuncios, serieVendedores);

  const subset = new Map<string, VendasMensais>();
  for (const id of distintos) {
    const est = estimativas.get(id);
    if (est) subset.set(id, est);
  }

  const mediana = medianaVendasMensaisDoUniverso(subset);
  const comEstimativa = contarComEstimativa(distintos, estimativas);

  if (mediana == null || comEstimativa === 0) {
    return {
      estado: 'sem_dado',
      mensagem: 'não dá para estimar o volume deste nicho',
    };
  }

  return {
    estado: 'valor',
    vendas_mes_mediana: mediana,
    vendedores_com_estimativa: comEstimativa,
    rotulo: `mediana de vendas/mês — loja inteira, janela 365d (${comEstimativa} vendedor${comEstimativa === 1 ? '' : 'es'})`,
  };
}

/** 3.3 — vendedores com estimativa válida ÷ vendedores distintos na amostra. */
export function calcularCoberturaEstimativa(
  anuncios: AnuncioAmostra[],
  serieVendedores: SnapshotVendedor[],
): CoberturaEstimativa {
  const { distintos, estimativas } = estimativasNaAmostra(anuncios, serieVendedores);
  const total = distintos.size;
  const comEstimativa = contarComEstimativa(distintos, estimativas);

  return {
    com_estimativa: comEstimativa,
    vendedores_distintos: total,
    proporcao: total > 0 ? comEstimativa / total : null,
    rotulo: total > 0 ? `${comEstimativa} de ${total} vendedores com estimativa mensal` : '0 vendedores na amostra',
  };
}

/** 3.4 — vendedores em serie_insuficiente ou sem_estimativa_no_periodo. */
export function calcularVendedoresSemEstimativa(
  anuncios: AnuncioAmostra[],
  serieVendedores: SnapshotVendedor[],
): VendedoresSemEstimativa {
  const { distintos, estimativas } = estimativasNaAmostra(anuncios, serieVendedores);
  let sem = 0;

  for (const id of distintos) {
    const est = estimativas.get(id);
    if (
      est == null ||
      est.estado === 'serie_insuficiente' ||
      est.estado === 'sem_estimativa_no_periodo'
    ) {
      sem++;
    }
  }

  return {
    contagem: sem,
    rotulo: `${sem} vendedor${sem === 1 ? '' : 'es'} sem estimativa mensal`,
  };
}

/** 7.4 — concentração por seller_id (ADR-0137-style share sobre Σ vendidos×preço). */
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
  const corte = Math.max(TOP1_DOMINANTE, 2 / faturamentos.length);

  return {
    elegiveis: faturamentos.length,
    vendedores_distintos: porVendedor.size,
    top1,
    corte,
    dominante: top1 >= corte,
    rotulo: `concentração por vendedor — ${faturamentos.length} com venda registrada na amostra`,
  };
}
