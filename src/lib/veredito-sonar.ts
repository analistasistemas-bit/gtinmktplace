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
import { itensDaAmostra, linkDoAnuncio } from './sonar';
import type { PainelVendasSonar, VisitasAnuncio } from './sonar';

export type NivelFator = 'bom' | 'medio' | 'ruim';
export type NivelVeredito = 'alta' | 'media' | 'baixa';
/** Entrada no nicho (ADR-0128): pergunta separada da Demanda — "dá para entrar?" ≠ "vende?".
 *  ESTADO INTERNO desde o ADR-0138: governa o composite `nivel`, mas a palavra "fechada" nunca
 *  chega à tela — o que o operador lê é `Barreira`. */
export type NivelEntrada = 'aberta' | 'fechada' | 'nao_medida';

/**
 * O que separa o operador do topo do nicho (ADR-0138). Substitui "entrada aberta/fechada" na
 * interface: o dado mede CUSTO de entrada, não porta trancada — nicho nenhum do ML é fechado a
 * preço. Separa as duas causas que o ADR-0128 colapsava numa palavra só, porque são negócios
 * diferentes: `concorrencia` é barreira de preço e logística (superável); `marca` é barreira
 * jurídica (risco de moderação por propriedade intelectual — incidente Aquaphor, 06/08), onde
 * desconto nenhum resolve.
 */
export type Barreira =
  | 'nenhuma'
  /** Caminho B da Disputa sem nada ruim: nenhum anúncio domina, mas sem nome de loja não dá para
   *  confirmar que os anúncios do topo são de donos diferentes — ADR-0137 proíbe declarar campo
   *  aberto sobre essa evidência, e a proibição vale para o TEXTO, não só para o score. */
  | 'topo_nao_confirmado'
  | 'concorrencia'
  | 'marca'
  | 'mercado_apertado'
  | 'nao_medida';

/** Rival no pódio por faturamento (vendidos×preço), incluindo anúncios sem rótulo de loja. */
export interface RivalPodio {
  item_id: string;
  titulo: string;
  /** null = fantasma (sem rótulo de loja) — rival por listing, não inventa loja na pulverização. */
  vendedor: string | null;
  vendidos: number | null;
  preco: number | null;
  faturamento: number;
  href: string | null;
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

// --- Linguagem comercial (ADR-0138) ------------------------------------------------------------
// Nenhum corte se move aqui: só o vocabulário. "Entrada fechada" morreu porque afirmava
// impossibilidade onde o dado mede CUSTO — nicho nenhum do ML é fechado a preço competitivo.

/** Handicap de preço para quem NÃO opera por Full, quando o topo do nicho é majoritariamente Full.
 *  HEURÍSTICA COMERCIAL do operador (28/08) — NÃO medida contra gabarito, ao contrário de
 *  DISPUTA_V2 / TRACAO_V2 / DEMANDA. Única constante não medida do arquivo; recalibrar com venda
 *  real, nunca com opinião. Motivo do handicap: empatar preço com um Full sendo não-Full não
 *  empata a disputa — o comprador decide pelo prazo antes de decidir pelo preço. */
const HANDICAP_NAO_FULL = 0.05;

const ROTULO_DEMANDA: Record<NivelFator, string> = {
  bom: 'Alta demanda',
  medio: 'Demanda comprovada',
  ruim: 'Sem prova de venda',
};

const ROTULO_BARREIRA: Record<Barreira, string> = {
  nenhuma: 'campo aberto',
  topo_nao_confirmado: 'topo aparentemente aberto',
  concorrencia: 'concorrência pesada',
  marca: 'risco de marca',
  mercado_apertado: 'mercado apertado',
  nao_medida: 'concorrência não medida',
};

/**
 * Função pura dos FATORES — nunca de `nivel` (ADR-0138 §1). Derivar do composite reintroduziria a
 * classe de bug que a Correção 2026-08-20 do ADR-0128 consertou: `nivel === 'baixa'` sequestrando
 * o título quando a causa real era outra. Marca vence tudo porque a recomendação de preço é
 * inválida sob risco de moderação — desconto nenhum evita anúncio derrubado por propriedade
 * intelectual.
 */
function derivarBarreira(
  entrada: NivelEntrada,
  disputa: DisputaMedida | null,
  tracao: { nivel: NivelFator } | null,
  marca: { nivel: NivelFator } | null,
): Barreira {
  if (entrada === 'nao_medida') return 'nao_medida';
  if (marca?.nivel === 'ruim') return 'marca';
  if (disputa?.nivel === 'ruim') return 'concorrencia';
  if (tracao?.nivel === 'ruim') return 'mercado_apertado';
  // O teto 'medio' do caminho B (ADR-0137) tem de chegar ao TEXTO, não só ao score: sem nome de
  // loja, N anúncios de um dono contam como N rivais, então "nenhum líder dominante" pode ser
  // território de marca disfarçado. Dizer "campo aberto" aqui contradiz a própria frase do Saiba
  // mais ("este caminho nunca declara o campo aberto") e empurra estoque para um topo que talvez
  // tenha um dono só. `entrada` e `nivel` seguem intocados — isto é só o rótulo.
  if (disputa?.caminho === 'anuncio') return 'topo_nao_confirmado';
  return 'nenhuma';
}

/** Gramática única em todos os casos: `<Demanda> · <Barreira>`. "Oportunidade alta/média/baixa"
 *  saiu do título — o nível continua governando a COR do card, só deixou de ser a manchete. */
function tituloVeredito(barreira: Barreira, demanda: NivelFator): string {
  if (demanda === 'ruim') return ROTULO_DEMANDA.ruim;
  return `${ROTULO_DEMANDA[demanda]} · ${ROTULO_BARREIRA[barreira]}`;
}

const fullDomina = (fullPct: number | null) => fullPct != null && fullPct >= DISPUTA_V2.fullMuito;

/** Um ramo da condição de entrada — "Com Full → bata R$ X" / "Sem Full → avalie R$ Y". */
export interface RamoEntrada { rotulo: string; texto: string }

/**
 * Condição de entrada (ADR-0138 §3) — sempre em PERCENTUAL, nunca em reais.
 *
 * Este card só existe na busca por TERMO, cuja amostra mistura embalagens: "abraçadeira nylon"
 * devolve Kit 500 a R$ 39,90, Kit 1000 a R$ 77,96 e Kit 50 a R$ 19,06 lado a lado. Um "bata
 * R$ 39,90" seria alvo de prejuízo para quem for cadastrar outro tamanho de kit — a mesma
 * armadilha que a Errata 1 do ADR-0124 usou para matar as faixas de preço do Sonar (estatística de
 * preço sobre itens incomparáveis não descreve nicho nenhum). Percentual atravessa embalagem:
 * "5% abaixo do equivalente" vale para qualquer kit.
 *
 * Valor absoluto fica reservado à consulta por EAN (`SonarEanResultado`), onde o produto é um só e
 * a comparação é legítima — regra do operador, 28/08. Aquela view NÃO usa este card.
 *
 * Vazio quando o Full não domina o topo: sem handicap de prazo não há o que compensar.
 */
function ramosDeEntrada(fullPct: number | null): RamoEntrada[] {
  if (!fullDomina(fullPct)) return [];
  return [
    {
      rotulo: 'Com Full',
      texto: `iguale o preço do concorrente equivalente ao seu produto — com ${pct(fullPct as number)} do topo medido entregando por Full, o prazo empata e a decisão volta pro preço.`,
    },
    {
      rotulo: 'Sem Full',
      texto: `igualar não basta: o comprador escolhe pelo prazo. Avalie entrar ${pct(HANDICAP_NAO_FULL * 100)} abaixo do concorrente equivalente para compensar a entrega — e confira na Viabilidade se esse desconto ainda fecha sua margem.`,
    },
  ];
}

/** Texto de ação do "Saiba mais": condição de entrada, não ordem de compra. O gate de demanda e o
 *  risco de marca são as duas únicas situações que mantêm tom imperativo — nelas preço não
 *  resolve. */
function acaoVeredito(
  barreira: Barreira,
  nivel: NivelVeredito,
  gateDemanda: boolean,
  razaoParcial: string | null,
  ramos: RamoEntrada[],
): string {
  if (gateDemanda) {
    // Se o veredito também é parcial, a causa precisa aparecer em algum lugar: com o gate ativo o
    // card de insight fala de demanda, não da concorrência, e o subtítulo que explicava isso morreu.
    const parcial = razaoParcial != null
      ? ` Além disso, não deu para avaliar a concorrência: ${razaoParcial}.`
      : '';
    return `Não compre estoque neste nicho. Sem prova de compra, volume é prejuízo. Só faria sentido com diferencial forte (preço de fábrica, kit exclusivo ou marca própria), e mesmo assim depois de validar a demanda.${parcial}`;
  }
  if (barreira === 'marca') {
    return 'Preço não resolve aqui: com a loja oficial dominando o topo, revender corre risco de moderação por propriedade intelectual — o anúncio pode ser derrubado com o estoque já comprado. Só entra com autorização de revenda da marca ou com marca própria.';
  }
  if (barreira === 'nao_medida') {
    const causa = razaoParcial != null ? razaoParcial : 'concorrência incompleta';
    return `Avaliação parcial: ${causa}. No máximo um anúncio-teste mínimo — nunca volume. Se for marca de laboratório/fórmula, trate como risco de marca até conferir a loja oficial.`;
  }
  // Invariante: `ramos` só é não-vazio com Full ≥ 60%, o que força Disputa 'ruim' nos DOIS caminhos
  // e portanto `barreira === 'concorrencia'` (marca já saiu acima). Por isso a condição de entrada
  // aparece só neste ramo — interpolá-la nos demais seria código morto.
  const condicao = ramos.length > 0
    ? ` ${ramos.map((r) => `${r.rotulo}: ${r.texto}`).join(' ')}`
    : '';
  if (barreira === 'concorrencia') {
    return `Dá para entrar, mas o topo já está ocupado — a fatia vem pelo preço, não por chegar primeiro.${condicao} Comece com anúncio-teste e valide o giro antes de comprar volume.`;
  }
  if (barreira === 'topo_nao_confirmado') {
    return 'Nenhum anúncio domina o faturamento pelo que deu para medir — mas os cards do topo não trazem nome de loja, então pode ser um dono só com vários anúncios em vez de vários concorrentes. Antes de comprar volume, abra os anúncios do topo e confira quem está por trás deles. Enquanto isso, anúncio-teste.';
  }
  if (barreira === 'mercado_apertado') {
    return 'O topo está livre, mas o faturamento está diluído entre os concorrentes — cada um leva pouco. Só compensa com custo baixo o bastante para volume pequeno fechar. Comece com anúncio-teste.';
  }
  if (nivel === 'alta') {
    return 'Campo aberto e venda comprovada. Publique com estoque conservador e valide o giro real nas primeiras semanas.';
  }
  return 'Dá para entrar sem briga pesada. Valide preço e frete contra os líderes antes de investir em estoque.';
}

/** Frase curta à direita do card. Nunca diz "demanda insuficiente" se a demanda não for o gate, e
 *  nunca manda não entrar fora do gate e do risco de marca — as duas situações em que preço não
 *  resolve. Sem isso o card se contradiria: "Como entrar: bata R$ 39,90" ao lado de "não entre". */
function resumoVeredito(
  barreira: Barreira,
  nivel: NivelVeredito,
  gateDemanda: boolean,
  disputa: DisputaMedida | null,
): string {
  if (gateDemanda) return 'Poucas provas de venda por aqui — teste antes de comprar estoque.';
  if (barreira === 'nao_medida') return 'Tem gente comprando, mas não deu pra medir quem já ocupa o topo — vá com cautela, sem volume.';
  if (barreira === 'marca') return 'A loja oficial domina o topo. O risco aqui não é preço, é ter o anúncio derrubado por propriedade intelectual.';
  if (barreira === 'concorrencia') {
    if (fullDomina(disputa?.fullPct ?? null)) {
      return 'Mercado aquecido e disputado no prazo: o topo entrega por Full. Dá pra entrar, mas o preço tem que compensar a entrega.';
    }
    // A causa muda a frase: o caminho B mede UM anúncio concentrando o faturamento; o caminho A
    // mede POUCOS concorrentes no topo. Dizer "um anúncio concentra" num nicho pulverizado com
    // faturamento uniforme seria afirmar um mecanismo que ninguém mediu.
    return disputa?.caminho === 'anuncio'
      ? 'Mercado aquecido, mas um anúncio concentra a maior parte do faturamento. Entrar exige preço melhor que o dele.'
      : 'Mercado aquecido, mas poucos concorrentes dominam o topo. Entrar exige preço melhor que o deles.';
  }
  if (barreira === 'topo_nao_confirmado') {
    return 'Ninguém domina o faturamento pelo que deu para medir — mas os cards não trazem nome de loja, então pode ser um dono só com vários anúncios. Confira antes de comprar volume.';
  }
  if (barreira === 'mercado_apertado') return 'Tem venda, mas o faturamento está diluído — sobra pouco por concorrente. Só compensa com custo baixo.';
  return nivel === 'alta'
    ? 'Venda comprovada e topo ainda aberto. Comece enxuto e valide o giro.'
    : 'Dá pra entrar sem briga pesada. Confira preço e frete contra os líderes antes de comprar volume.';
}

/** Chip ao lado do título: o NÚMERO que sustenta a barreira, não o nome do estado — o estado já
 *  está escrito no próprio título (ADR-0138 §1b). `null` quando não há número a mostrar. */
function chipBarreira(
  barreira: Barreira,
  gateDemanda: boolean,
  disputa: DisputaMedida | null,
  sub: SubamostraNomeada,
): string | null {
  // Sob o gate de demanda o título é "Sem prova de venda", sem eixo de barreira: um chip de
  // concorrência ali ficaria pendurado sem nada que o sustente.
  if (gateDemanda) return null;
  // `nao_medida` não ganha chip: o título já diz "· concorrência não medida", e repetir seria a
  // mesma redundância que aposentou o subtítulo.
  if (barreira === 'nao_medida') return null;
  if (barreira === 'marca') return 'loja oficial';
  if (barreira !== 'concorrencia' && barreira !== 'topo_nao_confirmado') return null;
  if (fullDomina(disputa?.fullPct ?? null)) return `${pct(disputa!.fullPct as number)} Full`;
  if (disputa?.caminho === 'anuncio' && disputa.concentracao != null) {
    return `líder leva ${pct(disputa.concentracao.top1 * 100)}`;
  }
  // "concorrentes", nunca "lojas": o card do ML imprime a MARCA (ADR-0127), e afirmar loja aqui
  // desmentiria a ressalva que o próprio Saiba mais faz duas linhas abaixo.
  if (disputa?.caminho === 'rotulo') return `${sub.distintos} concorrentes no topo`;
  return null;
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
  fatores: Fator[];
  marca: AlertaMarca | null;
  /** true quando faltou dado para medir a concorrência: a trava de cobertura (D10) tirou Disputa e
   *  Tração da conta, ou nenhum anúncio informou o tipo de envio (metade da Disputa). O veredito se
   *  DECLARA parcial e não chega a "alta" — falta de dado não é sinal de negócio, nem para cima. */
  parcial: boolean;
  /** Entrada no nicho (ADR-0128): aberta / fechada / não medida — estado INTERNO, nunca impresso.
   *  O que a tela mostra é `barreira` (ADR-0138). */
  entrada: NivelEntrada;
  /** O que separa o operador do topo (ADR-0138) — derivado dos fatores, nunca de `nivel`. */
  barreira: Barreira;
  /** Número que sustenta a barreira, para o chip ao lado do título. `null` = sem chip. */
  chip: string | null;
  /** Condição de entrada em percentual (ADR-0138); vazio quando o Full não domina o topo. */
  ramosEntrada: RamoEntrada[];
  /** Top 5 rivais por faturamento na amostra (inclui fantasmas sem rótulo). */
  rivaisPodio: RivalPodio[];
  /** Uma frase visível no card, sem abrir Saiba mais — linguajar de operador, não de score. */
  resumo: string;
  explicacao: Explicacao;
}

// --- Cortes MEDIDOS em 19/08 (ADR-0127 §Calibração v2, fixtures em __tests__/fixtures/) ---------
// PROIBIDO reaproveitar DISPUTA/TRACAO/VISITAS acima: a escala deles morreu com a fonte (D11).
// `scripts/sonar-gabarito-verificar.mjs` é a definição executável destas fórmulas.
const DISPUTA_V2 = { pulverizacaoConcentrada: 0.25, pulverizacaoAberta: 0.40, fullMuito: 60, fullPouco: 40 };
/** Caminho B da Disputa (ADR-0137): concentração por anúncio, quando o rótulo não cobre a amostra.
 *  `top1Dominante` saiu do vão medido entre o nicho aberto (oxford, 19,6%) e o fechado mais próximo
 *  (EUCERIN, 36,8%). `minElegiveis` + o fator 2× sobre o share uniforme evitam dominância por
 *  artefato de base pequena. PROIBIDO trocar top1 por top3 sem re-medir: no gabarito o top3 separa
 *  os nichos por 3 pontos (57,1% aberto vs. 60,2% fechado), ruído puro. */
const DISPUTA_B = { top1Dominante: 0.30, minElegiveis: 5 };
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

/** Concentração por anúncio (ADR-0137, caminho B da Disputa): share do anúncio líder no
 *  faturamento medido da amostra. Só entra em jogo quando o rótulo de loja não cobre a amostra —
 *  ver `nivelDisputaB`. */
export interface ConcentracaoAmostra {
  elegiveis: number;
  /** Share do anúncio líder no faturamento medido, 0-1. */
  top1: number;
  /** Corte aplicado: max(0,30 ; 2 ÷ elegíveis). */
  corte: number;
  dominante: boolean;
}

/**
 * Elegível = `vendidos != null && preco != null` (mesma regra de `subamostraNomeada` para
 * faturamento: ausência ≠ zero). `null` quando faltam elegíveis (< `DISPUTA_B.minElegiveis`) ou o
 * faturamento total é zero/negativo (evita divisão por zero) — LOUD: amostra insuficiente não vira
 * "sem concentração", vira "não medido".
 */
export function concentracaoAmostra(vendas: PainelVendasSonar): ConcentracaoAmostra | null {
  const elegiveis = itensDaAmostra(vendas).filter((i) => i.vendidos != null && i.preco != null);
  if (elegiveis.length < DISPUTA_B.minElegiveis) return null;
  const faturamentos = elegiveis.map((i) => (i.vendidos as number) * (i.preco as number));
  const total = faturamentos.reduce((a, f) => a + f, 0);
  if (total <= 0) return null;
  const top1 = Math.max(...faturamentos) / total;
  const corte = Math.max(DISPUTA_B.top1Dominante, 2 / elegiveis.length);
  return { elegiveis: elegiveis.length, top1, corte, dominante: top1 >= corte };
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

/** Medição da Disputa por um dos dois caminhos (ADR-0137). Caminho A (rótulo) é o titular — só
 *  ele pode declarar disputa 'bom' (território de marca). Caminho B (concentração por anúncio)
 *  entra quando o rótulo não cobre a amostra; teto 'medio', nunca 'bom' — ver `nivelDisputaB`. */
type DisputaMedida =
  | { caminho: 'rotulo'; nivel: NivelFator; detalhe: string; pulverizacao: number; fullPct: number | null }
  | { caminho: 'anuncio'; nivel: NivelFator; detalhe: string; concentracao: ConcentracaoAmostra | null; fullPct: number | null };

function nivelDisputaV2(vendas: PainelVendasSonar, sub: SubamostraNomeada): DisputaMedida | null {
  if (sub.cobertura < COBERTURA_MINIMA || sub.nomeados === 0) return null; // trava D10 → cede ao caminho B (ADR-0137)
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
    caminho: 'rotulo',
    nivel,
    detalhe: `${sub.distintos} concorrentes nos ${sub.nomeados} anúncios do topo · ${textoFull(fullPct)}`,
    pulverizacao,
    fullPct,
  };
}

function detalheDisputaB(conc: ConcentracaoAmostra | null, fullPct: number | null): string {
  const partes: string[] = [];
  if (conc != null) partes.push(`o líder leva ${pct(conc.top1 * 100)} do faturamento medido (${conc.elegiveis} anúncios com venda)`);
  if (fullPct != null) partes.push(textoFull(fullPct));
  return partes.join(' · ');
}

/**
 * Caminho B da Disputa (ADR-0137): concentração por anúncio, quando o caminho A (rótulo) não
 * mediu. Nunca devolve 'bom' — o teto é 'medio': sem rótulo de loja, anúncios da mesma loja podem
 * estar contados como rivais separados, então a concentração por anúncio SUBESTIMA a concentração
 * real; declarar o nicho aberto sobre essa subestimativa seria promover ausência de dado, proibido
 * em todo este arquivo (mesma regra do Full não medido).
 */
function nivelDisputaB(vendas: PainelVendasSonar): DisputaMedida | null {
  const fullPct = fullPctAmostra(vendas);
  const conc = concentracaoAmostra(vendas);
  if (fullPct == null && conc == null) return null; // nem envio nem concentração — nada pra medir
  const nivel: NivelFator = (fullPct != null && fullPct >= DISPUTA_V2.fullMuito) || conc?.dominante === true
    ? 'ruim'
    : 'medio';
  return {
    caminho: 'anuncio',
    nivel,
    detalhe: detalheDisputaB(conc, fullPct),
    concentracao: conc,
    fullPct,
  };
}

function nivelTracaoV2(sub: SubamostraNomeada): { nivel: NivelFator; detalhe: string; porRotulo: number } | null {
  if (sub.cobertura < COBERTURA_MINIMA || sub.distintos === 0) return null; // trava D10
  const porRotulo = sub.faturamento / sub.distintos;
  const nivel: NivelFator = porRotulo >= TRACAO_V2.boa ? 'bom'
    : porRotulo >= TRACAO_V2.media ? 'medio' : 'ruim';
  // Sem "por concorrente" no detalhe: o label do fator já diz isso (ADR-0138 §2).
  return { nivel, detalhe: `${brlMil(porRotulo)} na amostra`, porRotulo };
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
      href: linkDoAnuncio(i.link, i.item_id ?? ''),
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
  const lider = rivais[0];
  return ` Líder por faturamento: ${lider.titulo} (≈ ${fmtBRL(lider.faturamento)}).`;
}

// `montarMotivoAnuncios` foi removido no ADR-0138 §6: sob a gramática de dois eixos o subtítulo
// virou redundância pura ("Concorrência alta demais para o tamanho do mercado" embaixo de
// "Demanda comprovada · concorrência pesada"), e o resumo já faz a leitura do card.

function fraseDisputaV2(nivel: NivelFator, sub: SubamostraNomeada, pulverizacao: number, fullPct: number | null): string {
  // Ressalva do ADR-0127 no texto do operador: o card do ML imprime a MARCA, não o nickname da
  // loja, então duas lojas da mesma marca contam como uma. Fica no Saiba mais, não no facial.
  const base = `${sub.distintos} concorrentes distintos em ${sub.nomeados} anúncios identificáveis (pulverização ${num2(pulverizacao)}) — o Mercado Livre mostra a marca no card, não a loja, então duas lojas da mesma marca contam como uma`;
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
    return `a partir de pulverização ${num2(DISPUTA_V2.pulverizacaoAberta)} (concorrentes distintos ÷ anúncios identificáveis) a concorrência sairia da zona crítica — hoje é ${num2(pulverizacao)}`;
  }
  if (nivel === 'ruim') {
    return `com Full abaixo de ${DISPUTA_V2.fullMuito}% a disputa sairia da zona crítica — hoje: ${textoFull(fullPct)}`;
  }
  return `com pulverização a partir de ${num2(DISPUTA_V2.pulverizacaoAberta)} e Full até ${DISPUTA_V2.fullPouco}% a disputa entraria na faixa tranquila — hoje: ${num2(pulverizacao)} e ${textoFull(fullPct)}`;
}

/** Frase do fator Disputa no caminho B (ADR-0137 §Textos) — LOUD sobre três coisas: (a) o share é
 *  sobre o faturamento MEDIDO, e a faixa "+N vendidos" do ML é piso — o share real pode ser menor;
 *  (b) sem rótulo de loja, anúncios da mesma loja podem estar contados como rivais separados —
 *  por isso este caminho nunca declara o nicho aberto; (c) quantos anúncios entraram na conta. */
function fraseDisputaB(d: Extract<DisputaMedida, { caminho: 'anuncio' }>): string {
  const { concentracao: conc, fullPct, nivel } = d;
  const partes: string[] = [];
  if (conc != null) {
    partes.push(`o anúncio líder leva ${pct(conc.top1 * 100)} do faturamento medido entre ${conc.elegiveis} anúncios com venda registrada na amostra — a faixa "+N vendidos" do Mercado Livre é piso, então o share real pode ser menor`);
  }
  if (fullPct != null) {
    partes.push(`${textoFull(fullPct)} sobre os anúncios com envio identificado`);
  }
  const aviso = 'sem nome de loja no card para agrupar, dois anúncios do mesmo dono entram como se fossem dois concorrentes nesta conta — por isso este caminho nunca declara o campo aberto, no máximo médio';
  const fecho = nivel === 'ruim' ? 'o topo já está concentrado' : 'disputa moderada pelo que deu para medir';
  return `${partes.join('; ')}; ${aviso}; ${fecho}.`;
}

function destravarDisputaB(d: Extract<DisputaMedida, { caminho: 'anuncio' }>): string {
  if (d.nivel === 'ruim') {
    if (d.concentracao?.dominante) {
      return `com o líder abaixo de ${pct(d.concentracao.corte * 100)} do faturamento medido a disputa sairia da zona crítica — hoje: ${pct(d.concentracao.top1 * 100)}`;
    }
    return `com Full abaixo de ${DISPUTA_V2.fullMuito}% a disputa sairia da zona crítica — hoje: ${textoFull(d.fullPct)}`;
  }
  return 'este caminho tem teto médio: nome de loja identificável em pelo menos metade da amostra destravaria a medição completa (pulverização + Full) e abriria caminho para campo aberto';
}

function fraseTracaoV2(nivel: NivelFator, porRotulo: number): string {
  const valor = brlMil(porRotulo);
  const universo = 'numerador e denominador no mesmo universo (só anúncios com concorrente identificável)';
  if (nivel === 'ruim') {
    return `Cada concorrente identificado fatura ${valor} na amostra — abaixo de ${brlMil(TRACAO_V2.media)}, o bolo dividido é pequeno para justificar a entrada; ${universo}.`;
  }
  if (nivel === 'bom') {
    return `Cada concorrente identificado fatura ${valor} na amostra — acima de ${brlMil(TRACAO_V2.boa)}, o nicho sustenta quem entra agora; ${universo}.`;
  }
  return `Cada concorrente identificado fatura ${valor} na amostra — entre ${brlMil(TRACAO_V2.media)} e ${brlMil(TRACAO_V2.boa)}, dá para entrar sem grande folga; ${universo}.`;
}

/** Reuso das frases da Marca trocando o substantivo: agora medimos anúncios, não fichas. */
const marcaTexto = (s: string) => s
  .replace('das fichas ativas', 'dos anúncios da amostra')
  .replace('das fichas com loja oficial', 'dos anúncios com loja oficial');

export function calcularVereditoAnuncios(vendas: PainelVendasSonar, visitasTotal: number | null): VereditoAnuncios {
  const sub = subamostraNomeada(vendas);
  const demanda = nivelDemandaV2(vendas, visitasTotal);
  // Caminho A (rótulo) é o titular; caminho B (concentração por anúncio, ADR-0137) só entra
  // quando o A não mediu (cobertura de rótulo < 50%).
  const disputa = nivelDisputaV2(vendas, sub) ?? nivelDisputaB(vendas);
  const tracao = nivelTracaoV2(sub);
  const elegiveisVenda = itensDaAmostra(vendas).filter((i) => i.vendidos != null && i.preco != null).length;
  // `parcial` (ADR-0137 §"parcial redefinido"): nenhum caminho da Disputa mediu, OU o caminho A
  // mediu mas o Full (metade dele) não. `tracao == null` deixou de causar parcial sozinho — ele é
  // sempre null quando o caminho B está ativo, e travar por isso derrubaria exatamente as
  // consultas que o caminho B existe para destravar.
  const semFull = disputa != null && disputa.caminho === 'rotulo' && disputa.fullPct == null;
  const razaoParcial = disputa == null
    ? `nenhum anúncio da amostra informa o tipo de envio e só ${elegiveisVenda} de ${sub.analisados} anúncios têm vendidos e preço suficientes para medir concentração por anúncio (mínimo: ${DISPUTA_B.minElegiveis})`
    : semFull ? 'nenhum anúncio da amostra informa o tipo de envio' : null;
  const parcial = razaoParcial != null;

  // Rótulos comerciais (ADR-0138 §2): as CHAVES continuam 'disputa'/'tracao' — são nomes internos
  // e o gabarito depende delas —, só o texto na tela virou dicionário do comércio.
  const fatores: Fator[] = [{ chave: 'demanda', label: 'Demanda', nivel: demanda.nivel, detalhe: demanda.detalhe }];
  if (disputa) fatores.push({ chave: 'disputa', label: 'Concorrência', nivel: disputa.nivel, detalhe: disputa.detalhe });
  if (tracao) fatores.push({ chave: 'tracao', label: 'Faturamento por concorrente', nivel: tracao.nivel, detalhe: tracao.detalhe });

  const soma = fatores.reduce((acc, f) => acc + PONTOS[f.nivel], 0);
  const maximo = fatores.length * 2; // escala proporcional (ADR-0124 §4) absorve a trava D10
  const gateDemanda = demanda.nivel === 'ruim';
  const marca = alertaMarcaV2(vendas);
  const entrada = derivarEntrada(parcial, disputa, marca);
  const rivais = rivaisPodio(vendas);
  // "Alta" exige dado completo + entrada aberta (ADR-0128): marca ruim / disputa ruim fecham a
  // Entrada e impedem "alta"; parcial também (falta de dado nunca promove).
  //
  // ADR-0137 (errata): "alta" exige a Disputa medida POR RÓTULO. O caminho B tem teto 'medio' de
  // propósito — ele subestima a concentração real (N anúncios de um dono contam como N rivais) —,
  // mas sem esta cláusula o teto não chegava ao veredito: com a Tração fora, `fatores` tem 2 itens,
  // `maximo` é 4, e `soma >= maximo - 1` aprova tanto disputa 🟡 (3) quanto 🟢 (4). Ou seja, 🟡 e 🟢
  // davam a MESMA resposta final e o teto ficava invisível justamente em "alta", que é a única
  // faixa que significa "compre estoque". Evidência que o próprio ADR chama de fraca não decide
  // compra de estoque.
  const disputaPorRotulo = disputa?.caminho === 'rotulo';
  const nivel: NivelVeredito = gateDemanda || soma <= maximo / 3 ? 'baixa'
    : soma >= maximo - 1 && fatores.length >= PISO_FATORES_ALTA && !parcial && entrada === 'aberta'
      && disputaPorRotulo ? 'alta'
      : 'media';

  const fatoresExplicacao: ExplicacaoFator[] = [{
    chave: 'demanda',
    nivel: demanda.nivel,
    frase: fraseDemanda(demanda.nivel, demanda.vendasTotais, demanda.liquidez),
    regua: regua(0, 100, [Math.round(DEMANDA.liquidezRuim * 100), Math.round(DEMANDA.liquidezBoa * 100)], Math.round(demanda.liquidez * 100), false),
    destravar: demanda.nivel === 'bom' ? null : destravarDemanda(demanda.nivel, demanda.vendasTotais, demanda.liquidez),
  }];
  if (disputa) {
    if (disputa.caminho === 'rotulo') {
      fatoresExplicacao.push({
        chave: 'disputa',
        nivel: disputa.nivel,
        frase: fraseDisputaV2(disputa.nivel, sub, disputa.pulverizacao, disputa.fullPct)
          + (semFull
            ? ' Nenhum anúncio da amostra informa o tipo de envio: metade da Concorrência (o % Full) não pôde ser medida, então o fator não passa de intermediário e o veredito sai parcial — sem dado completo não se declara campo aberto.'
            : ''),
        // Pulverização MAIOR é melhor (campo aberto) — régua não invertida, ao contrário da antiga,
        // que contava vendedores absolutos.
        regua: regua(0, 1, [DISPUTA_V2.pulverizacaoConcentrada, DISPUTA_V2.pulverizacaoAberta], disputa.pulverizacao, false),
        destravar: disputa.nivel === 'bom' ? null : destravarDisputaV2(disputa.nivel, disputa.pulverizacao, disputa.fullPct),
      });
    } else {
      // Caminho B (ADR-0137): um corte só (dominância por faturamento), sem a régua de 3 zonas do
      // caminho A — inventar um segundo corte pra desenhar a régua seria número não medido.
      fatoresExplicacao.push({
        chave: 'disputa',
        nivel: disputa.nivel,
        frase: fraseDisputaB(disputa),
        regua: null,
        destravar: destravarDisputaB(disputa),
      });
    }
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
        : `a partir de ${brlMil(tracao.nivel === 'ruim' ? TRACAO_V2.media : TRACAO_V2.boa)} por concorrente o faturamento subiria de faixa — hoje: ${brlMil(tracao.porRotulo)}`,
    });
  } else if (disputa != null && disputa.caminho === 'anuncio') {
    // Caminho B mediu a Disputa, mas a Tração exige rótulo de loja (escala R$/rótulo não transfere
    // pra "por anúncio" sem segunda calibração, ADR-0137 §"parcial redefinido") — sem isso o
    // operador veria a Tração sumir sem explicação.
    fatoresExplicacao.push({
      chave: 'tracao',
      nivel: 'medio',
      frase: 'O faturamento por concorrente mede R$ por loja distinta — sem nome de loja cobrindo a amostra não há como calculá-lo nesta escala, então o fator saiu da pontuação (ausência não vira nota ruim).',
      regua: null,
      destravar: null,
    });
  }
  if (disputa == null) {
    // Nem o caminho A (rótulo) nem o B (concentração por anúncio) mediram: sem base para declarar
    // a concorrência do nicho. LOUD sobre o motivo real — nunca só "sem rótulo", porque a causa
    // também pode ser falta de anúncios com venda suficientes para medir concentração.
    fatoresExplicacao.push({
      chave: 'disputa',
      nivel: 'medio',
      frase: `Só ${sub.nomeados} de ${sub.analisados} anúncios trazem nome de loja e só ${elegiveisVenda} anúncios têm vendidos e preço suficientes para medir concentração por anúncio (mínimo: ${DISPUTA_B.minElegiveis}) — nem o Full nem a concentração por anúncio puderam medir a concorrência deste nicho. Concorrência e faturamento por concorrente saíram da pontuação; não viraram nota ruim, e por isso este veredito é parcial e não declara campo aberto.`,
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

  // Barreira e textos comerciais (ADR-0138). `barreira` é derivada dos FATORES, nunca de `nivel`.
  const barreira = derivarBarreira(entrada, disputa, tracao, marca);
  // Sem prova de venda não há entrada a condicionar; sob risco de marca, desconto não resolve.
  const ramosEntrada = gateDemanda || barreira === 'marca' || barreira === 'nao_medida'
    ? []
    : ramosDeEntrada(disputa?.fullPct ?? null);
  const chip = chipBarreira(barreira, gateDemanda, disputa, sub);
  const acao = acaoVeredito(barreira, nivel, gateDemanda, razaoParcial, ramosEntrada) + fraseRivaisPodio(rivais);
  const resumo = resumoVeredito(barreira, nivel, gateDemanda, disputa);

  return {
    nivel,
    titulo: tituloVeredito(barreira, demanda.nivel),
    fatores,
    marca,
    parcial,
    entrada,
    barreira,
    chip,
    ramosEntrada,
    rivaisPodio: rivais,
    resumo,
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

// ================= Insights do nicho (ADR-0124 addendum 2026-08-21; Errata 1 2026-08-27) =======
// Dois mini-cards SEMPRE visíveis (não escondidos no "Saiba mais"): entrada e pódio de rivais
// (duas colunas — faturamento e visitas). Faixas de preço morreram na Errata 1 (tercil sobre
// embalagens diferentes não descreve nicho nenhum) e o pódio de faturamento perdeu o rótulo de
// loja (Apify raramente traz `vendedor`). 100% derivados do que `calcularVereditoAnuncios`/
// `PainelVendasSonar`/visitas já trazem — sem chamada de rede nova, sem novo custo.

export interface InsightEntrada { titulo: string; detalhe: string; tom: NivelFator; ramos: RamoEntrada[] }

/**
 * Card "Como entrar neste nicho" (ADR-0138 §3) — antes era "Entrada fechada / Para destravar…".
 * O "para destravar" saiu daqui porque é conselho inexecutável (manda esperar o mercado mudar
 * sozinho) e já aparece por fator dentro do "Saiba mais" — nenhuma informação foi perdida, só
 * deixou de ser manchete.
 */
export function insightEntrada(v: VereditoAnuncios): InsightEntrada {
  const fatores = v.explicacao.fatores;
  if (v.explicacao.gateDemanda) {
    return {
      titulo: 'Sem prova de venda',
      tom: 'ruim',
      detalhe: 'Não há preço a bater aqui: os anúncios do topo não mostram compra suficiente para justificar estoque. Valide a demanda antes de pensar em entrada.',
      ramos: [],
    };
  }
  if (v.barreira === 'nao_medida') {
    // Duas causas possíveis (calcularVereditoAnuncios): trava de cobertura D10 (fator sem régua) ou
    // Full não medido em nenhum anúncio (fator 'disputa' comum, cuja frase já explica a causa).
    const causa = fatores.find((f) => f.regua === null) ?? fatores.find((f) => f.chave === 'disputa');
    return {
      titulo: 'Concorrência não medida',
      tom: 'medio',
      detalhe: causa?.frase ?? 'Não deu para medir a concorrência do nicho com os dados desta amostra.',
      ramos: [],
    };
  }
  if (v.barreira === 'marca') {
    // Sem preço, deliberadamente: desconto nenhum evita anúncio derrubado por propriedade
    // intelectual (incidente Aquaphor, 06/08). Mostrar "preço a bater" aqui seria conselho errado.
    const causa = fatores.find((f) => f.chave === 'marca');
    return {
      titulo: 'Risco de marca',
      tom: 'ruim',
      detalhe: `${causa?.frase ?? 'A loja oficial domina o topo desta amostra.'} Preço não resolve: só entra com autorização de revenda da marca ou com marca própria.`,
      ramos: [],
    };
  }
  const semBarreira = v.barreira === 'nenhuma';
  const detalhe = semBarreira
    ? 'Sem barreira estrutural detectada nesta amostra — campo livre pra quem chega agora.'
    : v.barreira === 'topo_nao_confirmado'
      // Nunca 'bom' aqui, e nunca a palavra "livre": o caminho B pode estar escondendo território
      // de marca (ADR-0137). O card manda conferir, não manda entrar.
      ? 'Nenhum anúncio domina o faturamento medido, mas os cards do topo não trazem nome de loja — vários anúncios podem ser do mesmo dono. Abra os anúncios do topo e confira quem está por trás antes de tratar como campo aberto.'
      : v.barreira === 'mercado_apertado'
        ? 'O topo está livre, mas o bolo é pequeno por concorrente: a entrada depende do seu custo, não da briga por espaço.'
        : 'O topo já está ocupado, mas a fatia se conquista no preço — não por chegar primeiro.';
  return {
    titulo: 'Como entrar neste nicho',
    tom: semBarreira ? 'bom' : 'medio',
    detalhe,
    ramos: v.ramosEntrada,
  };
}

export interface RivalVisitas {
  item_id: string; titulo: string; preco: number | null; visitas: number; href: string | null;
}

/**
 * Top 5 rivais por visitas na amostra. Elegibilidade DELIBERADAMENTE diferente de `rivaisPodio`:
 * aqui não existe `vendidos != null` — se herdasse esse filtro, o pódio de visitas nasceria vazio
 * na maioria das consultas (o ML não expõe "+N vendidos" para os anúncios mais visitados; ver
 * Errata 1 do ADR-0124). Elegível: `item_id` conhecido (dá pra chavear no Map de visitas), `preco`
 * conhecido e visitas medidas > 0 (Map devolve `null` = falha de medição, exclui; 0 exclui).
 */
export function rivaisPodioVisitas(
  vendas: PainelVendasSonar,
  visitasPorItem: Map<string, VisitasAnuncio | null>,
): RivalVisitas[] {
  return itensDaAmostra(vendas)
    .filter((i) => i.item_id != null && i.preco != null)
    .map((i) => ({
      item_id: i.item_id as string,
      titulo: i.titulo,
      preco: i.preco,
      visitas: visitasPorItem.get(i.item_id as string)?.total ?? 0,
      href: linkDoAnuncio(i.link, i.item_id as string),
    }))
    .filter((r) => r.visitas > 0)
    .sort((a, b) => b.visitas - a.visitas)
    .slice(0, 5);
}
