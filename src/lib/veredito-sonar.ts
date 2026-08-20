// Veredito de oportunidade do Sonar (ADR-0124): lê o painel oficial + as vendas e responde
// "dá para ENTRAR e vender neste nicho?" — não "este mercado é grande?". Mercado gigante e
// saturado vale MÉDIA; nicho pequeno com venda provada e quase sem concorrente vale ALTA.
//
// Vocabulário deliberadamente diferente do SemaforoPreco (ADR-0020, "Vale a pena"): aquele julga
// UM preço contra custo e piso; este julga um NICHO. Dois "vale a pena" na mesma tela com
// sentidos diferentes seria pior que dois nomes.
//
// Função pura: nenhuma chamada de rede, nenhum dado novo — só combina o que as duas consultas já
// trouxeram. Faixas calibradas em 18/08 (ADR-0124) contra 3 nichos reais; são constantes
// nomeadas de propósito, para recalibrar sem caçar número solto no meio do código.
import { fmtBRL, fmtInt, fmtMilhar } from './formato';
import { itensDaAmostra } from './sonar';
import type { PainelVendasSonar } from './sonar';

export type NivelFator = 'bom' | 'medio' | 'ruim';
export type NivelVeredito = 'alta' | 'media' | 'baixa';
/** Entrada no nicho (ADR-0128): pergunta separada da Demanda — "dá para entrar?" ≠ "vende?". */
export type NivelEntrada = 'aberta' | 'fechada' | 'nao_medida';

/** Rival no pódio por faturamento (vendidos×preço), incluindo anúncios sem rótulo de loja. */
export interface RivalPodio {
  item_id: string;
  titulo: string;
  /** null = fantasma (sem rótulo de loja) — rival por listing, não inventa loja na pulverização. */
  vendedor: string | null;
  vendidos: number | null;
  preco: number | null;
  faturamento: number;
}

export interface Fator {
  chave: 'demanda' | 'disputa' | 'tracao';
  label: string;
  nivel: NivelFator;
  /** Texto curto que aparece ao lado do fator — sempre o número cru que gerou o nível. */
  detalhe: string;
}

export interface AlertaMarca {
  nivel: NivelFator;
  detalhe: string;
}

/** Dados pra desenhar a mini-régua do "Saiba mais": onde o valor cai entre os dois cortes que
 *  definem ruim/médio/bom. `invertida` = maior é pior (disputa, marca). */
export interface ExplicacaoRegua {
  min: number;
  max: number;
  cortes: [number, number];
  valor: number;
  invertida: boolean;
}

export interface ExplicacaoFator {
  chave: 'demanda' | 'disputa' | 'tracao' | 'marca';
  nivel: NivelFator;
  /** Frase em linguagem de mercado, com os números reais da amostra vs. o corte. */
  frase: string;
  regua: ExplicacaoRegua | null;
  /** Delta concreto até a próxima faixa melhor; `null` quando já está em 'bom'. */
  destravar: string | null;
}

export interface Explicacao {
  pontuacao: { soma: number; maximo: number };
  /** true quando Demanda 🔴 sozinha forçou o veredito pra baixa (gate, ADR-0124 §4). */
  gateDemanda: boolean;
  fatores: ExplicacaoFator[];
  /** Frase de ação por nível do veredito, para o "Saiba mais". */
  acao: string;
}

/** Item de contexto que o score NÃO usa (ticket médio, % Full, mediana de preço) — leitura
 *  complementar pro "Saiba mais", nunca entra na pontuação. */
export interface ContextoItem {
  rotulo: string;
  valor: string;
}

// --- Cortes (ADR-0124 §faixas) ------------------------------------------------------------------
const DEMANDA = { liquidezBoa: 0.70, vendasBoas: 5_000, vendasMinimas: 1_000, liquidezRuim: 0.30 };
const MARCA = { aberto: 20, dominado: 50 };

const PONTOS: Record<NivelFator, number> = { bom: 2, medio: 1, ruim: 0 };
const pct = (n: number) => `${Math.round(n)}%`;
const brlMil = (n: number) => `R$ ${fmtMilhar(Math.round(n), 1)}`;

function nivelDemanda(vendas: PainelVendasSonar): { nivel: NivelFator; detalhe: string; liquidez: number; vendasTotais: number } {
  const liquidez = vendas.itens_analisados > 0
    ? vendas.itens_com_vendas / vendas.itens_analisados
    : 0;
  const detalhe = `${pct(liquidez * 100)} dos anúncios vendem`;
  if (vendas.vendas_totais < DEMANDA.vendasMinimas || liquidez < DEMANDA.liquidezRuim) {
    return { nivel: 'ruim', detalhe, liquidez, vendasTotais: vendas.vendas_totais };
  }
  if (liquidez >= DEMANDA.liquidezBoa && vendas.vendas_totais >= DEMANDA.vendasBoas) {
    return { nivel: 'bom', detalhe, liquidez, vendasTotais: vendas.vendas_totais };
  }
  return { nivel: 'medio', detalhe, liquidez, vendasTotais: vendas.vendas_totais };
}

const TITULO_BAIXA = 'Oportunidade baixa';
const TITULO_ALTA = 'Oportunidade alta';
const TITULO_MEDIA = 'Oportunidade média';

function tituloVeredito(nivel: NivelVeredito, entrada: NivelEntrada, demanda: NivelFator): string {
  if (demanda === 'ruim') return TITULO_BAIXA;
  if (entrada === 'nao_medida') {
    return demanda === 'bom'
      ? 'Demanda forte · concorrência não medida'
      : 'Demanda ok · concorrência não medida';
  }
  if (entrada === 'fechada') {
    return demanda === 'bom'
      ? 'Demanda forte · entrada fechada'
      : 'Demanda ok · entrada fechada';
  }
  if (nivel === 'baixa') return TITULO_BAIXA;
  if (nivel === 'alta') return TITULO_ALTA;
  return TITULO_MEDIA;
}

function acaoVeredito(
  nivel: NivelVeredito,
  entrada: NivelEntrada,
  gateDemanda: boolean,
  razaoParcial: string | null,
): string {
  if (gateDemanda) {
    return 'Não compre estoque neste nicho. Demanda insuficiente — sem prova de compra, volume é prejuízo. Esse nicho só faria sentido com diferencial forte (preço de fábrica, kit exclusivo ou marca própria), e mesmo assim só depois de validar a demanda.';
  }
  if (entrada === 'nao_medida') {
    const causa = razaoParcial != null ? razaoParcial : 'concorrência incompleta';
    return `Avaliação parcial: ${causa}. No máximo um anúncio-teste mínimo — nunca volume. Se for marca de laboratório/fórmula, trate como entrada fechada até conferir loja oficial.`;
  }
  if (entrada === 'fechada') {
    return 'Não compre estoque neste nicho. Tem gente comprando, mas a entrada está fechada (Full dominante ou loja oficial no topo). Volume é prejuízo. Só faria sentido com preço de fábrica, kit exclusivo ou marca própria — e mesmo assim só um anúncio-teste mínimo.';
  }
  if (nivel === 'baixa') {
    return 'Não compre estoque neste nicho. O mercado não sustenta mais um player genérico (disputa/tração). Só com diferencial forte, e só depois de validar.';
  }
  if (nivel === 'alta') {
    return 'Entrada aberta e sinais favoráveis. Ainda assim, publique com estoque conservador e valide o giro real nas primeiras semanas.';
  }
  return 'Entrada aberta, nicho viável com ressalvas. Valide preço e frete contra os líderes antes de investir em estoque — e mesmo assim comece conservador.';
}

function regua(min: number, max: number, cortes: [number, number], valor: number, invertida: boolean): ExplicacaoRegua {
  return { min, max, cortes, valor, invertida };
}

// --- Frases do "Saiba mais" (linguagem de mercado, números reais vs. corte) ---------------------

function fraseDemanda(nivel: NivelFator, vendasTotais: number, liquidez: number): string {
  const pctL = pct(liquidez * 100);
  if (nivel === 'ruim') {
    if (vendasTotais < DEMANDA.vendasMinimas) {
      return `Só ${fmtInt(vendasTotais)} vendas registradas na amostra — abaixo de ${fmtInt(DEMANDA.vendasMinimas)}, não há prova de compra suficiente para considerar o nicho comprador.`;
    }
    return `Apenas ${pctL} dos anúncios analisados venderam — abaixo de ${Math.round(DEMANDA.liquidezRuim * 100)}%, a maioria dos anúncios do topo nunca vendeu.`;
  }
  if (nivel === 'bom') {
    return `${pctL} dos anúncios analisados já venderam e o nicho acumula ${fmtInt(vendasTotais)} vendas — mercado comprovadamente comprador.`;
  }
  return `${pctL} dos anúncios analisados venderam e o nicho acumula ${fmtInt(vendasTotais)} vendas — mercado real, mas ainda não no patamar de demanda forte.`;
}

function destravarDemanda(nivel: NivelFator, vendasTotais: number, liquidez: number): string {
  if (nivel === 'ruim') {
    if (vendasTotais < DEMANDA.vendasMinimas) {
      return `com ${fmtInt(DEMANDA.vendasMinimas)} vendas na amostra a demanda sairia do piso — hoje são ${fmtInt(vendasTotais)}`;
    }
    return `a partir de ${Math.round(DEMANDA.liquidezRuim * 100)}% dos anúncios vendendo a demanda sairia do piso — hoje são ${pct(liquidez * 100)}`;
  }
  if (liquidez < DEMANDA.liquidezBoa) {
    return `a partir de ${Math.round(DEMANDA.liquidezBoa * 100)}% dos anúncios vendendo a demanda entraria na faixa forte — hoje são ${pct(liquidez * 100)}`;
  }
  return `a partir de ${fmtInt(DEMANDA.vendasBoas)} vendas na amostra a demanda entraria na faixa forte — hoje são ${fmtInt(vendasTotais)}`;
}

function fraseMarca(nivel: NivelFator, p: number): string {
  const pctM = pct(p);
  if (nivel === 'ruim') return `${pctM} das fichas ativas têm loja oficial — mercado dominado pela marca; revender com loja oficial forte tem risco de moderação por propriedade intelectual. Não pontua Demanda; marca ruim fecha a Entrada.`;
  if (nivel === 'medio') return `${pctM} das fichas ativas têm loja oficial — zona de atenção; confira se a marca permite revenda antes de cadastrar. Não pontua Demanda; só marca ruim fecha a Entrada.`;
  return `${pctM} das fichas ativas têm loja oficial — mercado aberto para revenda comum. Este fator não pontua Demanda; é alerta de risco (e marca ruim fecha a Entrada).`;
}

function destravarMarca(nivel: NivelFator, p: number): string {
  return nivel === 'ruim'
    ? `abaixo de ${MARCA.dominado}% das fichas com loja oficial este alerta sairia da zona crítica — hoje são ${pct(p)}`
    : `abaixo de ${MARCA.aberto}% das fichas com loja oficial este alerta desapareceria — hoje são ${pct(p)}`;
}

// ================= Veredito v2 (ADR-0127/D10-D12): a unidade é o ANÚNCIO =======================
// A tabela do Sonar deixou de listar fichas de catálogo e passou a listar anúncios reais vindos da
// Apify; o veredito é recalculado sobre eles. Sem painel de fichas e SEM fallback sem Apify (D16).
//
// O que mudou de verdade:
//  - Disputa v2 = PULVERIZAÇÃO (rótulos distintos ÷ anúncios com rótulo), razão 0-1 invariante ao
//    tamanho da amostra, + % Full. A contagem absoluta de vendedores morreu junto com a fonte
//    (D11): na amostra censurada de 20 anúncios o corte antigo de 25 era inatingível.
//  - Tração v2 = faturamento por rótulo da MESMA subamostra nomeada — numerador e denominador no
//    mesmo universo; com o denominador censurado a razão inflava.
//  - `frete_gratis` (85-100% nos 3 nichos), `patrocinado` (0% em 80 anúncios, provável limitação
//    do actor) e as visitas ficam FORA da pontuação (D12): saturados/sem variância, sem corte
//    derivável. Seguem como contexto — nunca viram nota.
//  - "vendedor" NÃO existe neste vocabulário: o card do ML imprime a MARCA, não o nickname (os 20
//    anúncios do EUCERIN dão 2 rótulos). Todo texto fala em RÓTULO DE LOJA.

export interface VereditoAnuncios {
  nivel: NivelVeredito;
  titulo: string;
  motivo: string;
  fatores: Fator[];
  marca: AlertaMarca | null;
  /** true quando faltou dado para medir a concorrência: a trava de cobertura (D10) tirou Disputa e
   *  Tração da conta, ou nenhum anúncio informou o tipo de envio (metade da Disputa). O veredito se
   *  DECLARA parcial e não chega a "alta" — falta de dado não é sinal de negócio, nem para cima. */
  parcial: boolean;
  /** Entrada no nicho (ADR-0128): aberta / fechada / não medida — pergunta separada da Demanda. */
  entrada: NivelEntrada;
  /** Top 5 rivais por faturamento na amostra (inclui fantasmas sem rótulo). */
  rivaisPodio: RivalPodio[];
  explicacao: Explicacao;
}

// --- Cortes MEDIDOS em 19/08 (ADR-0127 §Calibração v2, fixtures em __tests__/fixtures/) ---------
// PROIBIDO reaproveitar DISPUTA/TRACAO/VISITAS acima: a escala deles morreu com a fonte (D11).
// `scripts/sonar-gabarito-verificar.mjs` é a definição executável destas fórmulas.
const DISPUTA_V2 = { pulverizacaoConcentrada: 0.25, pulverizacaoAberta: 0.40, fullMuito: 60, fullPouco: 40 };
const TRACAO_V2 = { boa: 350_000, media: 15_000 };
/** "MENOS de 50% derruba" — 0,50 exato passa. O oxford, único nicho que o gabarito obriga a
 *  aprovar, mede exatamente 0,50: um `>` aqui derrubaria o critério de aceite. */
const COBERTURA_MINIMA = 0.5;
/** Com a trava D10 sobra só a Demanda: `maximo` cai para 2 e `soma >= maximo - 1` faria a Demanda
 *  🟡 SOZINHA virar "oportunidade alta" — sinal inventado a partir de ausência de dado. */
const PISO_FATORES_ALTA = 2;

const num2 = (n: number) => n.toFixed(2).replace('.', ',');
const textoFull = (fullPct: number | null) => (fullPct == null ? 'Full não medido' : `${pct(fullPct)} Full`);

export interface SubamostraNomeada {
  analisados: number;
  nomeados: number;
  distintos: number;
  cobertura: number;
  /** Σ vendidos × preço SÓ dos itens nomeados — mesmo universo do denominador. */
  faturamento: number;
}

/**
 * Rótulo CRU do card, sem normalizar: foi assim que o gabarito foi medido (EUCERIN imprime
 * "EUCERIN" e "EUCERIN Loja oficial" = 2 rótulos, pulverização 0,10). Colapsar os dois mudaria os
 * números da calibração sem re-medir. Item sem preço OU sem vendidos não soma (ausência ≠ zero).
 */
export function subamostraNomeada(vendas: PainelVendasSonar): SubamostraNomeada {
  const itens = itensDaAmostra(vendas);
  const rotulos = new Set<string>();
  let nomeados = 0;
  let faturamento = 0;
  for (const i of itens) {
    if (i.vendedor == null) continue;
    nomeados += 1;
    rotulos.add(i.vendedor);
    if (i.vendidos != null && i.preco != null) faturamento += i.vendidos * i.preco;
  }
  // Denominador é `itens_analisados` (o mesmo do script de calibração), não `itens.length`: no
  // fallback por `por_anuncio` (cache v4 pré-ADR-0127) anúncio sem `item_id` some do índice, e
  // dividir pelo que sobrou inflaria a cobertura — a trava D10 ficaria mais permissiva que a
  // definição medida.
  const analisados = vendas.itens_analisados;
  return {
    analisados,
    nomeados,
    distintos: rotulos.size,
    cobertura: analisados > 0 ? nomeados / analisados : 0,
    faturamento,
  };
}

/** % Full sobre os anúncios que TÊM envio identificado — não sobre a amostra inteira. `raio_x.full`
 *  conta só `full === true`; dividir por `itens_analisados` jogaria cada `envio: ""` no denominador
 *  como se fosse "não-Full", diluindo o número para baixo — e % Full baixo é lido como pouca
 *  concorrência estruturada, ou seja, a ausência de dado PROMOVERIA a Disputa (8 Full medidos + 12
 *  sem envio: 40% diluído vs. 100% medido — duas faixas de veredito). `null` quando nenhum anúncio
 *  traz envio identificado — aí o termo sai da regra de Disputa em vez de virar 0% (LOUD: ausência
 *  não é dado). Mesmo denominador da variante `fullLoud` de `scripts/sonar-gabarito-verificar.mjs`;
 *  nenhum corte da Calibração v2 se move. */
function fullPctAmostra(vendas: PainelVendasSonar): number | null {
  const medidos = itensDaAmostra(vendas).filter((i) => i.full != null);
  if (medidos.length === 0) return null;
  return (medidos.filter((i) => i.full === true).length / medidos.length) * 100;
}

/** Demanda intacta (D11) + visitas como CONTEXTO no detalhe. Não existe `VISITAS_V2`: o único
 *  consumidor de um corte de visitas era o fallback do ADR-0124 §6, revogado. */
function nivelDemandaV2(vendas: PainelVendasSonar, visitasTotal: number | null) {
  const d = nivelDemanda(vendas);
  return {
    ...d,
    detalhe: visitasTotal != null
      ? `${d.detalhe} · ${fmtMilhar(visitasTotal, 1)} visitas/30d na amostra`
      : d.detalhe,
  };
}

function nivelDisputaV2(vendas: PainelVendasSonar, sub: SubamostraNomeada): {
  nivel: NivelFator; detalhe: string; pulverizacao: number; fullPct: number | null;
} | null {
  if (sub.cobertura < COBERTURA_MINIMA || sub.nomeados === 0) return null; // trava D10
  const pulverizacao = sub.distintos / sub.nomeados;
  const fullPct = fullPctAmostra(vendas);
  // Topo concentrado sob poucos rótulos = território fechado; maioria Full = concorrente com
  // estoque em CD. Sem Full medido (`fullPct` null) o fator fica LIMITADO A 'medio': ausência não
  // vira 0% (que puxaria para 'bom') e também não pode PROMOVER — o facial é 🔴 só pela cláusula
  // de Full, e sem ela viraria 🟢/alta em silêncio num nicho que o gabarito fixa em média.
  // Ausência de dado nunca melhora um veredito (mesma regra que o ORIGEM de 14/07 custou caro).
  const nivel: NivelFator = pulverizacao <= DISPUTA_V2.pulverizacaoConcentrada
    || (fullPct != null && fullPct >= DISPUTA_V2.fullMuito)
    ? 'ruim'
    : pulverizacao >= DISPUTA_V2.pulverizacaoAberta && fullPct != null && fullPct <= DISPUTA_V2.fullPouco
      ? 'bom'
      : 'medio';
  return {
    nivel,
    detalhe: `${sub.distintos} rótulos de loja em ${sub.nomeados} anúncios · ${textoFull(fullPct)}`,
    pulverizacao,
    fullPct,
  };
}

function nivelTracaoV2(sub: SubamostraNomeada): { nivel: NivelFator; detalhe: string; porRotulo: number } | null {
  if (sub.cobertura < COBERTURA_MINIMA || sub.distintos === 0) return null; // trava D10
  const porRotulo = sub.faturamento / sub.distintos;
  const nivel: NivelFator = porRotulo >= TRACAO_V2.boa ? 'bom'
    : porRotulo >= TRACAO_V2.media ? 'medio' : 'ruim';
  return { nivel, detalhe: `${brlMil(porRotulo)} por rótulo de loja`, porRotulo };
}

/** Marca vira % da AMOSTRA de anúncios com loja oficial (antes era % de fichas). Não pontua
 *  Demanda — alerta de risco; marca ruim fecha a Entrada (ADR-0128). */
function alertaMarcaV2(vendas: PainelVendasSonar): { nivel: NivelFator; detalhe: string; pct: number } | null {
  if (vendas.itens_analisados === 0) return null;
  const p = (vendas.raio_x.lojas_oficiais / vendas.itens_analisados) * 100;
  const detalhe = `${pct(p)} da amostra com loja oficial`;
  if (p > MARCA.dominado) return { nivel: 'ruim', detalhe, pct: p };
  if (p >= MARCA.aberto) return { nivel: 'medio', detalhe, pct: p };
  return { nivel: 'bom', detalhe, pct: p };
}

/**
 * Top 5 rivais por faturamento (vendidos×preço) na amostra — inclui fantasmas (`vendedor == null`).
 * Não altera a pulverização: fantasmas continuam fora de `subamostraNomeada`.
 */
export function rivaisPodio(vendas: PainelVendasSonar): RivalPodio[] {
  return itensDaAmostra(vendas)
    .filter((i) => i.vendidos != null && i.preco != null)
    .map((i) => ({
      item_id: i.item_id ?? '',
      titulo: i.titulo,
      vendedor: i.vendedor,
      vendidos: i.vendidos,
      preco: i.preco,
      faturamento: (i.vendidos as number) * (i.preco as number),
    }))
    .filter((r) => r.faturamento > 0)
    .sort((a, b) => b.faturamento - a.faturamento)
    .slice(0, 5);
}

function derivarEntrada(
  parcial: boolean,
  disputa: { nivel: NivelFator } | null,
  marca: { nivel: NivelFator } | null,
): NivelEntrada {
  // Cobertura < 50% ou Full não medido → nunca declarar "oportunidade alta"; entrada não medida.
  if (parcial) return 'nao_medida';
  if (disputa?.nivel === 'ruim' || marca?.nivel === 'ruim') return 'fechada';
  return 'aberta';
}

function fraseRivaisPodio(rivais: RivalPodio[]): string {
  if (rivais.length === 0) return '';
  const lista = rivais
    .map((r) => (r.vendedor == null ? 'sem rótulo' : r.vendedor))
    .join(', ');
  const fantasma = rivais.some((r) => r.vendedor == null)
    ? ' Anúncio sem rótulo de loja ainda é rival — o líder sem nome não some da briga.'
    : '';
  return `${fantasma} Pódio por faturamento: ${lista}.`;
}

function montarMotivoAnuncios(nivel: NivelVeredito, fatores: Fator[], razaoParcial: string | null): string {
  if (razaoParcial != null && nivel !== 'baixa') {
    return `Não deu para avaliar a concorrência do nicho: ${razaoParcial}.`;
  }
  const pior = fatores.find((f) => f.nivel === 'ruim');
  if (nivel === 'baixa') {
    if (pior?.chave === 'demanda') return 'Sem vendas comprovadas entre os anúncios do topo.';
    if (pior?.chave === 'tracao') return 'Muitos rótulos de loja brigando por pouco dinheiro.';
    return 'Concorrência alta demais para o tamanho do mercado.';
  }
  if (nivel === 'alta') return 'Demanda comprovada e topo da busca ainda aberto.';
  if (pior?.chave === 'disputa') return 'Mercado forte, mas o topo da busca já está ocupado.';
  if (pior?.chave === 'tracao') return 'Há procura, mas o dinheiro está diluído entre os rótulos de loja da amostra.';
  return 'Nicho viável, sem folga — depende do seu custo.';
}

function fraseDisputaV2(nivel: NivelFator, sub: SubamostraNomeada, pulverizacao: number, fullPct: number | null): string {
  const base = `${sub.distintos} rótulos de loja distintos em ${sub.nomeados} anúncios com rótulo identificável (pulverização ${num2(pulverizacao)})`;
  if (nivel === 'ruim') {
    const partes: string[] = [];
    if (pulverizacao <= DISPUTA_V2.pulverizacaoConcentrada) {
      partes.push(`${base} — em ${num2(DISPUTA_V2.pulverizacaoConcentrada)} ou menos o topo da busca é território fechado, não campo livre`);
    }
    if (fullPct != null && fullPct >= DISPUTA_V2.fullMuito) {
      partes.push(`${pct(fullPct)} da amostra é Full — concorrente com estoque em CD dominando o campo`);
    }
    return `${partes.join('; ')}; entrar exige disputar espaço com quem já ocupa o topo.`;
  }
  if (nivel === 'bom') {
    return `${base} e ${textoFull(fullPct)} — campo ainda aberto para quem chega agora.`;
  }
  return `${base} e ${textoFull(fullPct)} — disputa moderada, ainda dá para entrar com diferencial.`;
}

function destravarDisputaV2(nivel: NivelFator, pulverizacao: number, fullPct: number | null): string {
  if (nivel === 'ruim' && pulverizacao <= DISPUTA_V2.pulverizacaoConcentrada) {
    return `a partir de pulverização ${num2(DISPUTA_V2.pulverizacaoAberta)} (rótulos de loja distintos ÷ anúncios com rótulo) a disputa sairia da zona crítica — hoje é ${num2(pulverizacao)}`;
  }
  if (nivel === 'ruim') {
    return `com Full abaixo de ${DISPUTA_V2.fullMuito}% a disputa sairia da zona crítica — hoje: ${textoFull(fullPct)}`;
  }
  return `com pulverização a partir de ${num2(DISPUTA_V2.pulverizacaoAberta)} e Full até ${DISPUTA_V2.fullPouco}% a disputa entraria na faixa tranquila — hoje: ${num2(pulverizacao)} e ${textoFull(fullPct)}`;
}

function fraseTracaoV2(nivel: NivelFator, porRotulo: number): string {
  const valor = brlMil(porRotulo);
  const universo = 'numerador e denominador no mesmo universo (só anúncios com rótulo de loja)';
  if (nivel === 'ruim') {
    return `Cada rótulo de loja identificado fatura ${valor} na amostra — abaixo de ${brlMil(TRACAO_V2.media)}, o bolo dividido é pequeno para justificar a entrada; ${universo}.`;
  }
  if (nivel === 'bom') {
    return `Cada rótulo de loja identificado fatura ${valor} na amostra — acima de ${brlMil(TRACAO_V2.boa)}, o nicho sustenta quem entra agora; ${universo}.`;
  }
  return `Cada rótulo de loja identificado fatura ${valor} na amostra — entre ${brlMil(TRACAO_V2.media)} e ${brlMil(TRACAO_V2.boa)}, dá para entrar sem grande folga; ${universo}.`;
}

/** Reuso das frases da Marca trocando o substantivo: agora medimos anúncios, não fichas. */
const marcaTexto = (s: string) => s
  .replace('das fichas ativas', 'dos anúncios da amostra')
  .replace('das fichas com loja oficial', 'dos anúncios com loja oficial');

export function calcularVereditoAnuncios(vendas: PainelVendasSonar, visitasTotal: number | null): VereditoAnuncios {
  const sub = subamostraNomeada(vendas);
  const demanda = nivelDemandaV2(vendas, visitasTotal);
  const disputa = nivelDisputaV2(vendas, sub);
  const tracao = nivelTracaoV2(sub);
  // Duas causas de veredito parcial, ambas LOUD: sem rótulo de loja na maioria dos anúncios
  // (trava D10) ou sem NENHUM tipo de envio informado (metade da Disputa não medida).
  const semRotulo = disputa == null || tracao == null;
  const semFull = disputa != null && disputa.fullPct == null;
  const razaoParcial = semRotulo
    ? 'menos da metade dos anúncios traz rótulo de loja'
    : semFull ? 'nenhum anúncio da amostra informa o tipo de envio' : null;
  const parcial = razaoParcial != null;

  const fatores: Fator[] = [{ chave: 'demanda', label: 'Demanda', nivel: demanda.nivel, detalhe: demanda.detalhe }];
  if (disputa) fatores.push({ chave: 'disputa', label: 'Disputa', nivel: disputa.nivel, detalhe: disputa.detalhe });
  if (tracao) fatores.push({ chave: 'tracao', label: 'Tração', nivel: tracao.nivel, detalhe: tracao.detalhe });

  const soma = fatores.reduce((acc, f) => acc + PONTOS[f.nivel], 0);
  const maximo = fatores.length * 2; // escala proporcional (ADR-0124 §4) absorve a trava D10
  const gateDemanda = demanda.nivel === 'ruim';
  const marca = alertaMarcaV2(vendas);
  const entrada = derivarEntrada(parcial, disputa, marca);
  const rivais = rivaisPodio(vendas);
  // "Alta" exige dado completo + entrada aberta (ADR-0128): marca ruim / disputa ruim fecham a
  // Entrada e impedem "alta"; parcial também (falta de dado nunca promove).
  const nivel: NivelVeredito = gateDemanda || soma <= maximo / 3 ? 'baixa'
    : soma >= maximo - 1 && fatores.length >= PISO_FATORES_ALTA && !parcial && entrada === 'aberta' ? 'alta'
      : 'media';

  const fatoresExplicacao: ExplicacaoFator[] = [{
    chave: 'demanda',
    nivel: demanda.nivel,
    frase: fraseDemanda(demanda.nivel, demanda.vendasTotais, demanda.liquidez),
    regua: regua(0, 100, [Math.round(DEMANDA.liquidezRuim * 100), Math.round(DEMANDA.liquidezBoa * 100)], Math.round(demanda.liquidez * 100), false),
    destravar: demanda.nivel === 'bom' ? null : destravarDemanda(demanda.nivel, demanda.vendasTotais, demanda.liquidez),
  }];
  if (disputa) {
    fatoresExplicacao.push({
      chave: 'disputa',
      nivel: disputa.nivel,
      frase: fraseDisputaV2(disputa.nivel, sub, disputa.pulverizacao, disputa.fullPct)
        + (semFull
          ? ' Nenhum anúncio da amostra informa o tipo de envio: metade da Disputa (o % Full) não pôde ser medida, então o fator não passa de intermediário e o veredito sai parcial — sem dado completo não se declara oportunidade alta.'
          : ''),
      // Pulverização MAIOR é melhor (campo aberto) — régua não invertida, ao contrário da antiga,
      // que contava vendedores absolutos.
      regua: regua(0, 1, [DISPUTA_V2.pulverizacaoConcentrada, DISPUTA_V2.pulverizacaoAberta], disputa.pulverizacao, false),
      destravar: disputa.nivel === 'bom' ? null : destravarDisputaV2(disputa.nivel, disputa.pulverizacao, disputa.fullPct),
    });
  }
  if (tracao) {
    const teto = TRACAO_V2.boa * 2;
    fatoresExplicacao.push({
      chave: 'tracao',
      nivel: tracao.nivel,
      frase: fraseTracaoV2(tracao.nivel, tracao.porRotulo),
      // Marcador preso ao teto: nicho de marca chega a R$ 5,7 mi/rótulo e sairia da barra.
      regua: regua(0, teto, [TRACAO_V2.media, TRACAO_V2.boa], Math.min(Math.round(tracao.porRotulo), teto), false),
      destravar: tracao.nivel === 'bom' ? null
        : `a partir de ${brlMil(tracao.nivel === 'ruim' ? TRACAO_V2.media : TRACAO_V2.boa)} por rótulo de loja a tração subiria de faixa — hoje: ${brlMil(tracao.porRotulo)}`,
    });
  }
  if (semRotulo) {
    // Trava D10 visível no "Saiba mais": indisponível ≠ ruim, e o veredito diz isso em voz alta.
    fatoresExplicacao.push({
      chave: 'disputa',
      nivel: 'medio',
      frase: `Só ${sub.nomeados} de ${sub.analisados} anúncios da amostra trazem rótulo de loja (mínimo: ${Math.round(COBERTURA_MINIMA * 100)}%) — sem base para medir a concorrência do nicho. Disputa e Tração saíram da pontuação; não viraram nota ruim, e por isso este veredito é parcial e não declara oportunidade alta.`,
      regua: null,
      destravar: null,
    });
  }
  if (marca) {
    fatoresExplicacao.push({
      chave: 'marca',
      nivel: marca.nivel,
      frase: marcaTexto(fraseMarca(marca.nivel, marca.pct)),
      regua: regua(0, 100, [MARCA.aberto, MARCA.dominado], Math.round(marca.pct), true),
      destravar: marca.nivel === 'bom' ? null : marcaTexto(destravarMarca(marca.nivel, marca.pct)),
    });
  }

  const acao = acaoVeredito(nivel, entrada, gateDemanda, razaoParcial) + fraseRivaisPodio(rivais);

  return {
    nivel,
    titulo: tituloVeredito(nivel, entrada, demanda.nivel),
    motivo: montarMotivoAnuncios(nivel, fatores, razaoParcial),
    fatores,
    marca,
    parcial,
    entrada,
    rivaisPodio: rivais,
    explicacao: { pontuacao: { soma, maximo }, gateDemanda, fatores: fatoresExplicacao, acao },
  };
}

/** Contexto fora do score (mediana de preço, ticket, % Full, % internacionais) — tudo da amostra
 *  de anúncios. `% Full` usa a mesma base da Disputa, para a tela não mostrar dois números. */
export function contextoNichoAnuncios(vendas: PainelVendasSonar): ContextoItem[] {
  const itens: ContextoItem[] = [];
  const precos = itensDaAmostra(vendas)
    .map((i) => i.preco)
    .filter((p): p is number => p != null)
    .sort((a, b) => a - b);
  if (precos.length > 0) {
    const meio = Math.floor(precos.length / 2);
    const mediana = precos.length % 2 === 1 ? precos[meio] : (precos[meio - 1] + precos[meio]) / 2;
    itens.push({ rotulo: 'Preço mediano da amostra', valor: fmtBRL(mediana) });
  }
  const rx = vendas.raio_x;
  if (rx.ticket_medio != null) itens.push({ rotulo: 'Ticket médio da amostra', valor: fmtBRL(rx.ticket_medio) });
  if (vendas.itens_analisados > 0) {
    const full = fullPctAmostra(vendas);
    itens.push({ rotulo: '% Full na amostra', valor: full == null ? 'não medido' : pct(full) });
    itens.push({ rotulo: '% internacionais na amostra', valor: pct((rx.internacionais / vendas.itens_analisados) * 100) });
  }
  return itens;
}
