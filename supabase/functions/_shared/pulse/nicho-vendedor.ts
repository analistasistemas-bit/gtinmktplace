// Agregações de nicho por vendedor (ADR-0142 + ADR-0143): campos 3.2, 3.3, 3.4 e 7.4 do contrato.
// Função pura — sem I/O. A ponte da amostra para o vendedor é o CATÁLOGO (ADR-0143 D-1): estas
// funções recebem os vendedores já resolvidos, não os deduzem do item_id.
//
// 2.6/2.8/3.1 não existem mais: o faturamento do nicho saiu do ar (ADR-0143 D-3) porque somar
// `vendas_mes` da loja inteira × preço de um anúncio do nicho produziu R$ 187,2 mi com 94,5%
// vindos de uma única conta institucional. Ausência declarada > precisão falsa.

import {
  agruparSeriePorVendedor,
  diasDecorridos,
  estimarVendasMensais,
  mediaMensal12m,
  normalizarSellerId,
  totalMaisRecentePorVendedor,
  type SnapshotVendedor,
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

/** 3.4 — quem ficou de fora da conta, e por quê (ADR-0146 Errata 1). */
export type VendedoresForaDaConta = {
  contagem: number;
  total_no_catalogo: number;
  rotulo: string;
};

/** 3.6 — tendência do nicho: delta ponta-a-ponta dos estabelecidos com série, contra o ano
 *  passado (ADR-0146 D-3). Delta negativo NÃO some — conta em `encolhendo`. */
export type TendenciaNicho = {
  estabelecidos: number;
  crescendo: number;
  estaveis: number;
  encolhendo: number;
  /** Menos de 2 snapshots — não dá para comparar com o ano passado. */
  sem_serie: number;
  proporcao_crescendo: number | null;
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

// ADR-0146 D-4: com `total ÷ 12` não há problema de resolução (a média é exata, não depende de
// janela). O corte sobrevive por COMPOSIÇÃO — a cauda de contas que nunca venderam domina a
// mediana. Medido no aptamil premium 2: sem o corte, mediana 1; com o corte, mediana 322.
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

/** Quantos `ids` têm entrada em `totais` (total do snapshot mais recente) — ADR-0146: um
 *  snapshot já basta, então isto é praticamente "quantos têm série alguma". */
function contarComTotal12m(ids: Set<string>, totais: Map<string, number>): number {
  let n = 0;
  for (const id of ids) if (totais.has(id)) n++;
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

/** Mediana exata (sem arredondar) — para un./mês, nunca média aritmética (ADR-0142 D-6). */
function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const v = [...valores].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 0 ? (v[mid - 1] + v[mid]) / 2 : v[mid];
}

/**
 * 3.6 — tendência: delta ponta-a-ponta dos estabelecidos com série, contra o mesmo período de um
 * ano atrás (ADR-0146 D-3). Reusa os estados de `estimarVendasMensais` — ela já classifica o sinal
 * do delta (`valor` com `vendas_mes` >0/=0 → crescendo/estável; `sem_estimativa_no_periodo` →
 * encolhendo; `serie_insuficiente` → sem_serie) — e só recalcula os dias de janela por fora,
 * porque o estado negativo não carrega `dias_janela`.
 */
export function calcularTendenciaNicho(
  sellerIds: Array<string | number>,
  serie: SnapshotVendedor[],
): TendenciaNicho {
  const estabelecidos = vendedoresEstabelecidos(sellerIds, serie);
  const estimativas = estimarVendasMensais(serie);
  const porVendedor = agruparSeriePorVendedor(serie);

  let crescendo = 0;
  let estaveis = 0;
  let encolhendo = 0;
  let semSerie = 0;
  const dias: number[] = [];

  for (const id of estabelecidos) {
    const est = estimativas.get(id);
    if (est == null || est.estado === 'serie_insuficiente') {
      semSerie++;
      continue;
    }
    if (est.estado === 'sem_estimativa_no_periodo') {
      encolhendo++;
    } else if (est.vendas_mes > 0) {
      crescendo++;
    } else {
      estaveis++;
    }
    const snaps = porVendedor.get(id);
    if (snaps && snaps.length >= 2) {
      dias.push(diasDecorridos(snaps[0].dia, snaps[snaps.length - 1].dia));
    }
  }

  const nEstabelecidos = estabelecidos.size;
  const comparaveis = nEstabelecidos - semSerie;
  const diasJanela = medianaDiasArredondada(dias);

  let rotulo: string;
  if (nEstabelecidos === 0) {
    rotulo = 'nenhum vendedor estabelecido nos catálogos desta amostra';
  } else {
    const sufixoDias = diasJanela != null
      ? ` (comparado com os mesmos ${diasJanela} dias de 12 meses atrás)`
      : '';
    rotulo = `${crescendo} de ${comparaveis} vendedores estabelecidos vendendo mais que há um ano${sufixoDias}`;
  }

  return {
    estabelecidos: nEstabelecidos,
    crescendo,
    estaveis,
    encolhendo,
    sem_serie: semSerie,
    proporcao_crescendo: comparaveis > 0 ? crescendo / comparaveis : null,
    dias_janela: diasJanela,
    base_pequena: nEstabelecidos > 0 && nEstabelecidos < MIN_BASE_ATIVIDADE,
    rotulo,
  };
}

/**
 * 3.2 — mediana da média mensal dos últimos 12 meses (`total ÷ 12`) entre os vendedores
 * ESTABELECIDOS do catálogo (ADR-0146 D-1, população restrita pela D-1 da 0145). Um snapshot
 * basta (D-2): não depende de série nem de delta — inclusive delta negativo entra (D-3).
 */
export function calcularVolumeNicho(
  sellerIds: Array<string | number>,
  serieVendedores: SnapshotVendedor[],
): VolumeNicho {
  const estabelecidos = vendedoresEstabelecidos(sellerIds, serieVendedores);
  if (estabelecidos.size === 0) {
    return { estado: 'sem_dado', mensagem: 'nenhum vendedor estabelecido nos catálogos desta amostra' };
  }

  const totais = totalMaisRecentePorVendedor(serieVendedores);
  const medias: number[] = [];
  for (const id of estabelecidos) {
    const total = totais.get(id);
    if (total != null) medias.push(mediaMensal12m(total));
  }

  if (medias.length < MIN_VENDEDORES_NICHO) {
    return {
      estado: 'sem_dado',
      // "N de 5 mínimos" só lê certo quando estabelecidos == 5 por coincidência. Com 20
      // estabelecidos e 4 com estimativa, o operador leria que o nicho tem 5 vendedores.
      mensagem: `apenas ${medias.length} vendedor${medias.length === 1 ? '' : 'es'} estabelecido${medias.length === 1 ? '' : 's'} com estimativa mensal (mínimo ${MIN_VENDEDORES_NICHO})`,
    };
  }

  const medianaVendas = mediana(medias);
  if (medianaVendas == null) {
    return { estado: 'sem_dado', mensagem: 'não dá para estimar o volume deste nicho' };
  }

  return {
    estado: 'valor',
    vendas_mes_mediana: medianaVendas,
    vendedores_com_estimativa: medias.length,
    rotulo: `média mensal dos últimos 12 meses — loja inteira (${medias.length} vendedores estabelecidos)`,
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
  // ADR-0146: com_estimativa agora conta estabelecidos com média de 12 meses — praticamente todos
  // os que têm ao menos 1 snapshot (um snapshot já basta, D-2).
  const totais = totalMaisRecentePorVendedor(serieVendedores);
  const comEstimativa = contarComTotal12m(estabelecidos, totais);

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

/**
 * 3.4 — vendedores do catálogo que ficaram **fora** da conta por não serem estabelecidos.
 *
 * A definição anterior ("sem estimativa mensal") virou estruturalmente zero na ADR-0146: como um
 * snapshot já basta para 3.2 e ser estabelecido exige um snapshot, não existe estabelecido sem
 * estimativa. Campo que só diz zero é ruído — este passa a declarar **quem a régua excluiu**, que
 * é a informação honesta a dar ao operador.
 */
export function calcularVendedoresForaDaConta(
  sellerIds: Array<string | number>,
  serieVendedores: SnapshotVendedor[],
): VendedoresForaDaConta {
  const ids = distintos(sellerIds);
  const estabelecidos = vendedoresEstabelecidos(sellerIds, serieVendedores);
  const fora = ids.size - estabelecidos.size;

  return {
    contagem: fora,
    total_no_catalogo: ids.size,
    rotulo: fora > 0
      ? `${fora} de ${ids.size} concorrentes ficaram de fora: menos de ${MIN_TOTAL_ESTABELECIDO} vendas na vida`
      : 'nenhum concorrente ficou de fora da conta',
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
