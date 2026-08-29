// Agregações de nicho por vendedor (ADR-0142 + ADR-0143): campos 3.2, 3.3, 3.4 e 7.4 do contrato.
// Função pura — sem I/O. A ponte da amostra para o vendedor é o CATÁLOGO (ADR-0143 D-1): estas
// funções recebem os vendedores já resolvidos, não os deduzem do item_id.
//
// 2.6/2.8/3.1 não existem mais: o faturamento do nicho saiu do ar (ADR-0143 D-3) porque somar
// `vendas_mes` da loja inteira × preço de um anúncio do nicho produziu R$ 187,2 mi com 94,5%
// vindos de uma única conta institucional. Ausência declarada > precisão falsa.

import {
  agruparSeriePorVendedor,
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
  /** Quantos dos vendedores distintos são estabelecidos (ADR-0145 D-1). */
  estabelecidos: number;
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

/** 3.6 — atividade do nicho, entre os vendedores estabelecidos (ADR-0145 D-2). */
export type AtividadeNicho = {
  estabelecidos: number;
  ativos: number;
  proporcao: number | null;
  dias_janela: number | null;
  base_pequena: boolean;
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
// Spike 045: com 1 vendedor a mediana é esse vendedor. Mesmo piso de 7.3/7.4. ADR-0145 D-3: agora
// conta estabelecidos com estimativa, não a população crua.
const MIN_VENDEDORES_NICHO = 5;
// ADR-0145 D-3: abaixo disso a atividade (contagem) ainda aparece, mas com aviso de base pequena —
// diferente do piso acima, que suprime a mediana.
const MIN_BASE_ATIVIDADE = 5;

// Spike 046: abaixo de 50 transações históricas, 67% dos vendedores dão delta zero em 13 dias —
// é a faixa sobre a qual o instrumento não tem resolução. Acima, 97-100% mostram movimento.
// Calibração inicial revisável (ADR-0145 D-7), não constante universal.
const MIN_TOTAL_ESTABELECIDO = 50;

/** Rótulo obrigatório da ADR-0143 D-2 — o conjunto NÃO é "vendedores da amostra". */
export const UNIDADE_VENDEDOR =
  'vendedores que disputam os catálogos desta amostra (vendas/mês da loja inteira)';

function distintos(sellerIds: Array<string | number>): Set<string> {
  return new Set(sellerIds.map(normalizarSellerId));
}

/** Estabelecido = total >= 50 no PRIMEIRO snapshot. Nunca filtrar pelo delta (ADR-0145 D-1). */
export function vendedoresEstabelecidos(
  sellerIds: Array<string | number>,
  serie: SnapshotVendedor[],
): Set<string> {
  const ids = distintos(sellerIds);
  const porVendedor = agruparSeriePorVendedor(serie);
  const out = new Set<string>();
  for (const id of ids) {
    const snaps = porVendedor.get(id);
    if (snaps && snaps.length > 0 && snaps[0].transactions_total >= MIN_TOTAL_ESTABELECIDO) {
      out.add(id);
    }
  }
  return out;
}

function contarComEstimativa(ids: Set<string>, estimativas: Map<string, VendasMensais>): number {
  let n = 0;
  for (const id of ids) if (estimativas.get(id)?.estado === 'valor') n++;
  return n;
}

/** Mediana arredondada — só serve para contagens de dias (dias_janela é inteiro por natureza).
 *  Não reusar para un./mês ou R$: arredondar aí seria perda de precisão indevida. */
function medianaDiasArredondada(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  const m = v.length % 2 === 0 ? (v[mid - 1] + v[mid]) / 2 : v[mid];
  return Math.round(m);
}

/** Mediana de `dias_janela` entre os `ids` com estado `valor` — reusa o dado já calculado por
 *  `estimarVendasMensais`, nunca recalcula (regra do ADR-0145). */
function medianaDiasJanela(ids: Set<string>, estimativas: Map<string, VendasMensais>): number | null {
  const dias: number[] = [];
  for (const id of ids) {
    const est = estimativas.get(id);
    if (est?.estado === 'valor') dias.push(est.dias_janela);
  }
  return medianaDiasArredondada(dias);
}

/** 3.6 — atividade: quantos estabelecidos venderam, e em quantos dias (ADR-0145 D-2/D-6). */
export function calcularAtividadeNicho(
  sellerIds: Array<string | number>,
  serie: SnapshotVendedor[],
): AtividadeNicho {
  const estabelecidos = vendedoresEstabelecidos(sellerIds, serie);
  const estimativas = estimarVendasMensais(serie);

  let ativos = 0;
  for (const id of estabelecidos) {
    const est = estimativas.get(id);
    if (est?.estado === 'valor' && est.vendas_mes > 0) ativos++;
  }

  const diasJanela = medianaDiasJanela(estabelecidos, estimativas);
  const nEstabelecidos = estabelecidos.size;

  let rotulo: string;
  if (nEstabelecidos === 0) {
    rotulo = 'nenhum vendedor estabelecido nos catálogos desta amostra';
  } else {
    const sufixoDias = diasJanela != null ? ` em ${diasJanela} dias` : '';
    rotulo = `${ativos} de ${nEstabelecidos} vendedores estabelecidos venderam${sufixoDias}`;
  }

  return {
    estabelecidos: nEstabelecidos,
    ativos,
    proporcao: nEstabelecidos > 0 ? ativos / nEstabelecidos : null,
    dias_janela: diasJanela,
    base_pequena: nEstabelecidos > 0 && nEstabelecidos < MIN_BASE_ATIVIDADE,
    rotulo,
  };
}

/**
 * 3.2 — mediana de vendas_mes entre os vendedores ESTABELECIDOS do catálogo com estado valor
 * (D-6 da 0142, população restrita pela D-1 da 0145).
 */
export function calcularVolumeNicho(
  sellerIds: Array<string | number>,
  serieVendedores: SnapshotVendedor[],
): VolumeNicho {
  const estabelecidos = vendedoresEstabelecidos(sellerIds, serieVendedores);
  if (estabelecidos.size === 0) {
    return { estado: 'sem_dado', mensagem: 'nenhum vendedor estabelecido nos catálogos desta amostra' };
  }

  const estimativas = estimarVendasMensais(serieVendedores);
  const comEstimativa = contarComEstimativa(estabelecidos, estimativas);

  if (comEstimativa < MIN_VENDEDORES_NICHO) {
    return {
      estado: 'sem_dado',
      // "N de 5 mínimos" só lê certo quando estabelecidos == 5 por coincidência. Com 20
      // estabelecidos e 4 com estimativa, o operador leria que o nicho tem 5 vendedores.
      mensagem: `apenas ${comEstimativa} vendedor${comEstimativa === 1 ? '' : 'es'} estabelecido${comEstimativa === 1 ? '' : 's'} com estimativa mensal (mínimo ${MIN_VENDEDORES_NICHO})`,
    };
  }

  const subset = new Map<string, VendasMensais>();
  for (const id of estabelecidos) {
    const est = estimativas.get(id);
    if (est) subset.set(id, est);
  }

  const medianaVendas = medianaVendasMensaisDoUniverso(subset);
  if (medianaVendas == null) {
    return { estado: 'sem_dado', mensagem: 'não dá para estimar o volume deste nicho' };
  }

  const diasJanela = medianaDiasJanela(estabelecidos, estimativas);
  const sufixoDias = diasJanela != null ? ` em ${diasJanela} dias,` : ',';

  return {
    estado: 'valor',
    vendas_mes_mediana: medianaVendas,
    vendedores_com_estimativa: comEstimativa,
    rotulo: `mediana de vendas/mês — movimento observado${sufixoDias} extrapolado para 30 `
      + `(loja inteira, ${comEstimativa} vendedores estabelecidos)`,
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
  const estabelecidos = vendedoresEstabelecidos(sellerIds, serieVendedores);
  const estimativas = estimarVendasMensais(serieVendedores);
  const comEstimativa = contarComEstimativa(estabelecidos, estimativas);

  const rotuloAnuncios = anunciosNaAmostra > 0
    ? `${anunciosComCatalogo} de ${anunciosNaAmostra} anúncios da amostra têm catálogo`
    : '0 anúncios na amostra';
  const rotuloVendedores = estabelecidos.size > 0
    ? ` — ${comEstimativa} de ${estabelecidos.size} vendedores estabelecidos com estimativa mensal`
    : '';

  return {
    com_estimativa: comEstimativa,
    vendedores_distintos: ids.size,
    estabelecidos: estabelecidos.size,
    // Numerador e denominador têm que ser a MESMA população. `comEstimativa` já conta só
    // estabelecidos (ADR-0145 D-1); dividir pela população crua daria 37/116 ao lado de um rótulo
    // dizendo "37 de 50" — o defeito de denominador que o spike 045 já pegou uma vez.
    proporcao: estabelecidos.size > 0 ? comEstimativa / estabelecidos.size : null,
    anuncios_na_amostra: anunciosNaAmostra,
    anuncios_com_catalogo: anunciosComCatalogo,
    proporcao_anuncios: anunciosNaAmostra > 0 ? anunciosComCatalogo / anunciosNaAmostra : null,
    rotulo: rotuloAnuncios + rotuloVendedores,
  };
}

/** 3.4 — estabelecidos em serie_insuficiente, sem_estimativa_no_periodo ou sem série alguma. */
export function calcularVendedoresSemEstimativa(
  sellerIds: Array<string | number>,
  serieVendedores: SnapshotVendedor[],
): VendedoresSemEstimativa {
  const estabelecidos = vendedoresEstabelecidos(sellerIds, serieVendedores);
  const estimativas = estimarVendasMensais(serieVendedores);
  let sem = 0;

  for (const id of estabelecidos) {
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
