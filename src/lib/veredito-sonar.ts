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
import type { PainelSonar, PainelVendasSonar } from './sonar';

export type NivelFator = 'bom' | 'medio' | 'ruim';
export type NivelVeredito = 'alta' | 'media' | 'baixa';

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

export interface Veredito {
  nivel: NivelVeredito;
  titulo: string;
  motivo: string;
  fatores: Fator[];
  marca: AlertaMarca | null;
  /** true quando as vendas não vieram (Apify fora/sem token) e a demanda caiu no proxy de visitas. */
  semVendas: boolean;
  explicacao: Explicacao;
}

/** Item de contexto que o score NÃO usa (ticket médio, % Full, mediana de preço) — leitura
 *  complementar pro "Saiba mais", nunca entra na pontuação. */
export interface ContextoItem {
  rotulo: string;
  valor: string;
}

// --- Cortes (ADR-0124 §faixas) ------------------------------------------------------------------
const DEMANDA = { liquidezBoa: 0.70, vendasBoas: 5_000, vendasMinimas: 1_000, liquidezRuim: 0.30 };
const DISPUTA = { vendedoresPoucos: 10, vendedoresMuitos: 25, fretePouco: 50, freteMuito: 85 };
const TRACAO = { boa: 150_000, media: 30_000 };
const MARCA = { aberto: 20, dominado: 50 };
// NÃO usar `total_catalogo` como guard de "nicho grande demais para julgar pela amostra": o ML
// satura esse campo em 10.000 e, medido em 18/08, dois nichos de tamanhos opostos ("EUCERIN
// protetor solar" e "tecido oxford 10 metros") mostram exatamente 10.000. Como gate ele desligaria
// o fator Disputa em quase todo termo. Quem já discrimina é `vendedores_distintos` na amostra —
// 27 no primeiro contra 7 no segundo.
// Sem vendas, a demanda cai nas visitas — cortes generosos porque medimos só o item mais barato
// de cada ficha, o que subestima bastante o tráfego real.
const VISITAS = { boas: 10_000, minimas: 300 };

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

function nivelDemandaPorVisitas(painel: PainelSonar): { nivel: NivelFator; detalhe: string; visitas: number } {
  const v = painel.agregado.visitas_30d_total;
  const detalhe = `${fmtMilhar(v, 1)} visitas em 30 dias`;
  if (v < VISITAS.minimas) return { nivel: 'ruim', detalhe, visitas: v };
  if (v >= VISITAS.boas) return { nivel: 'bom', detalhe, visitas: v };
  return { nivel: 'medio', detalhe, visitas: v };
}

function nivelDisputa(painel: PainelSonar): { nivel: NivelFator; detalhe: string; vendedores: number; frete: number } {
  const vendedores = painel.agregado.vendedores_distintos;
  const frete = painel.agregado.frete_gratis_pct;
  const detalhe = `${vendedores} vendedores · ${pct(frete)} com frete grátis`;
  // Frete grátis alto sinaliza vendedor estruturado (Full), não um campo amador — entrar custa mais.
  if (vendedores > DISPUTA.vendedoresMuitos || frete >= DISPUTA.freteMuito) {
    return { nivel: 'ruim', detalhe, vendedores, frete };
  }
  if (vendedores <= DISPUTA.vendedoresPoucos && frete <= DISPUTA.fretePouco) {
    return { nivel: 'bom', detalhe, vendedores, frete };
  }
  return { nivel: 'medio', detalhe, vendedores, frete };
}

/** R$ acumulados por concorrente: R$ 600 mil entre 7 vendedores é negócio; entre 200, não é. */
function nivelTracao(
  painel: PainelSonar,
  vendas: PainelVendasSonar,
): { nivel: NivelFator; detalhe: string; porVendedor: number } {
  const vendedores = painel.agregado.vendedores_distintos;
  const porVendedor = vendedores > 0 ? vendas.valor_mercado / vendedores : 0;
  const detalhe = `R$ ${fmtMilhar(Math.round(porVendedor), 1)} por vendedor`;
  const nivel: NivelFator = porVendedor >= TRACAO.boa ? 'bom'
    : porVendedor >= TRACAO.media ? 'medio' : 'ruim';
  return { nivel, detalhe, porVendedor };
}

/** Só alerta visual — decisão do Diego em 18/08: marca forte não derruba o veredito, avisa. */
function alertaMarca(painel: PainelSonar): { nivel: NivelFator; detalhe: string; pct: number } | null {
  const ativas = painel.fichas.filter((f) => f.ofertas > 0);
  if (ativas.length === 0) return null;
  const comOficial = ativas.filter((f) => f.vendedores.some((v) => v.loja_oficial)).length;
  const p = (comOficial / ativas.length) * 100;
  const detalhe = `${pct(p)} das fichas com loja oficial`;
  if (p > MARCA.dominado) return { nivel: 'ruim', detalhe, pct: p };
  if (p >= MARCA.aberto) return { nivel: 'medio', detalhe, pct: p };
  return { nivel: 'bom', detalhe, pct: p };
}

function montarMotivo(nivel: NivelVeredito, fatores: Fator[], semVendas: boolean): string {
  const pior = fatores.find((f) => f.nivel === 'ruim');
  if (nivel === 'baixa') {
    if (pior?.chave === 'demanda') {
      return semVendas
        ? 'Quase ninguém procura por este termo.'
        : 'Sem vendas comprovadas entre os anúncios do topo.';
    }
    if (pior?.chave === 'tracao') return 'Muitos vendedores brigando por pouco dinheiro.';
    return 'Concorrência alta demais para o tamanho do mercado.';
  }
  if (nivel === 'alta') return 'Demanda comprovada e quase sem disputa.';
  if (pior?.chave === 'disputa') return 'Mercado forte, mas disputa alta e profissionalizada.';
  if (pior?.chave === 'tracao') return 'Há procura, mas o dinheiro está diluído entre vendedores.';
  return 'Nicho viável, sem folga — depende do seu custo.';
}

const TITULOS: Record<NivelVeredito, string> = {
  alta: 'Oportunidade alta',
  media: 'Oportunidade média',
  baixa: 'Oportunidade baixa',
};

const ACAO: Record<NivelVeredito, string> = {
  baixa: 'Evite entrar com produto genérico. Esse nicho só faz sentido com diferencial forte — preço de fábrica, kit exclusivo ou marca própria.',
  media: 'Nicho viável com ressalvas. Valide preço e frete contra os líderes antes de investir em estoque.',
  alta: 'Sinais favoráveis. Ainda assim, publique com estoque conservador e valide o giro real nas primeiras semanas.',
};

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
    return `Apenas ${pctL} dos anúncios analisados venderam — abaixo de ${Math.round(DEMANDA.liquidezRuim * 100)}%, a maioria das fichas do topo nunca vendeu.`;
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

function fraseDemandaVisitas(nivel: NivelFator, visitas: number): string {
  const v = fmtMilhar(visitas, 1);
  if (nivel === 'ruim') return `Só ${v} visitas em 30 dias — pouquíssima procura pelo termo; sem dados de venda, esta é uma leitura por tráfego.`;
  if (nivel === 'bom') return `${v} visitas em 30 dias — tráfego forte; sem dados de venda, esta é uma leitura por tráfego, não uma prova de compra.`;
  return `${v} visitas em 30 dias — tráfego mediano; sem dados de venda, leitura por tráfego apenas.`;
}

function destravarDemandaVisitas(nivel: NivelFator, visitas: number): string {
  const alvo = nivel === 'ruim' ? VISITAS.minimas : VISITAS.boas;
  const rotulo = nivel === 'ruim' ? 'sairia do piso' : 'entraria na faixa forte';
  return `a partir de ${fmtMilhar(alvo, 1)} visitas em 30 dias a demanda ${rotulo} — hoje são ${fmtMilhar(visitas, 1)}`;
}

function fraseDisputa(nivel: NivelFator, vendedores: number, frete: number): string {
  const pctF = pct(frete);
  if (nivel === 'ruim') {
    const partes: string[] = [];
    if (vendedores > DISPUTA.vendedoresMuitos) {
      partes.push(`${vendedores} vendedores disputam o mesmo comprador — acima de ${DISPUTA.vendedoresMuitos} o mercado é considerado saturado`);
    }
    if (frete >= DISPUTA.freteMuito) {
      partes.push(`frete grátis em ${pctF} dos anúncios mostra vendedor estruturado (Full) dominando o campo`);
    }
    return `${partes.join('; ')}; entrar exige roubar atenção de players estabelecidos.`;
  }
  if (nivel === 'bom') {
    return `Só ${vendedores} vendedores disputam este nicho, com frete grátis em ${pctF} dos anúncios — mercado ainda aberto para quem chega agora.`;
  }
  return `${vendedores} vendedores disputam a atenção do comprador, com frete grátis em ${pctF} dos anúncios — disputa moderada, ainda dá para entrar com diferencial.`;
}

function destravarDisputa(vendedores: number, frete: number): string {
  if (vendedores > DISPUTA.vendedoresMuitos) {
    return `com até ${DISPUTA.vendedoresMuitos} vendedores a disputa sairia da zona crítica — hoje são ${vendedores}`;
  }
  if (frete >= DISPUTA.freteMuito) {
    return `com frete grátis abaixo de ${DISPUTA.freteMuito}% a disputa sairia da zona crítica — hoje é ${pct(frete)}`;
  }
  return `com até ${DISPUTA.vendedoresPoucos} vendedores e frete grátis até ${DISPUTA.fretePouco}% a disputa entraria na faixa mais tranquila — hoje são ${vendedores} vendedores e ${pct(frete)} de frete grátis`;
}

function fraseTracao(nivel: NivelFator, porVendedor: number): string {
  const valor = brlMil(porVendedor);
  if (nivel === 'ruim') return `Cada vendedor fatura em média ${valor} — abaixo de R$ 30 mil, o bolo dividido é pequeno para justificar a entrada.`;
  if (nivel === 'bom') return `Cada vendedor fatura em média ${valor} — acima de R$ 150 mil, o nicho sustenta quem entra agora sem brigar por migalhas.`;
  return `Cada vendedor fatura em média ${valor} — entre R$ 30 mil e R$ 150 mil, dá para entrar mas sem grande folga.`;
}

function destravarTracao(nivel: NivelFator): string {
  return nivel === 'ruim'
    ? 'a partir de R$ 30 mil por vendedor a tração passaria a contar a favor'
    : 'a partir de R$ 150 mil por vendedor a tração deixaria de ser intermediária e passaria a puxar o veredito para cima';
}

function fraseMarca(nivel: NivelFator, p: number): string {
  const pctM = pct(p);
  if (nivel === 'ruim') return `${pctM} das fichas ativas têm loja oficial — mercado dominado pela marca; revender com loja oficial forte tem risco de moderação por propriedade intelectual. Não entra na pontuação.`;
  if (nivel === 'medio') return `${pctM} das fichas ativas têm loja oficial — zona de atenção; confira se a marca permite revenda antes de cadastrar. Não entra na pontuação.`;
  return `${pctM} das fichas ativas têm loja oficial — mercado aberto para revenda comum. Este fator não entra na pontuação; é só um alerta de risco.`;
}

function destravarMarca(nivel: NivelFator, p: number): string {
  return nivel === 'ruim'
    ? `abaixo de ${MARCA.dominado}% das fichas com loja oficial este alerta sairia da zona crítica — hoje são ${pct(p)}`
    : `abaixo de ${MARCA.aberto}% das fichas com loja oficial este alerta desapareceria — hoje são ${pct(p)}`;
}

/**
 * `vendas` null (Apify indisponível ou sem token) → demanda vira proxy de visitas e Tração sai da
 * conta, com `semVendas: true` para a UI dizer que o veredito está com meia informação. Nunca
 * inventa vendas a partir de visitas (proibido pelo ADR-0120).
 */
export function calcularVeredito(
  painel: PainelSonar,
  vendas: PainelVendasSonar | null,
): Veredito {
  const semVendas = vendas == null;
  const disputa = nivelDisputa(painel);

  let demanda: { nivel: NivelFator; detalhe: string };
  let fatorDemandaExplicacao: ExplicacaoFator;

  if (semVendas) {
    const d = nivelDemandaPorVisitas(painel);
    demanda = d;
    fatorDemandaExplicacao = {
      chave: 'demanda',
      nivel: d.nivel,
      frase: fraseDemandaVisitas(d.nivel, d.visitas),
      regua: regua(0, VISITAS.boas * 1.5, [VISITAS.minimas, VISITAS.boas], d.visitas, false),
      destravar: d.nivel === 'bom' ? null : destravarDemandaVisitas(d.nivel, d.visitas),
    };
  } else {
    const d = nivelDemanda(vendas);
    demanda = d;
    fatorDemandaExplicacao = {
      chave: 'demanda',
      nivel: d.nivel,
      frase: fraseDemanda(d.nivel, d.vendasTotais, d.liquidez),
      regua: regua(0, 100, [Math.round(DEMANDA.liquidezRuim * 100), Math.round(DEMANDA.liquidezBoa * 100)], Math.round(d.liquidez * 100), false),
      destravar: d.nivel === 'bom' ? null : destravarDemanda(d.nivel, d.vendasTotais, d.liquidez),
    };
  }

  const fatores: Fator[] = [
    { chave: 'demanda', label: 'Demanda', nivel: demanda.nivel, detalhe: demanda.detalhe },
    { chave: 'disputa', label: 'Disputa', nivel: disputa.nivel, detalhe: disputa.detalhe },
  ];
  const fatorDisputaExplicacao: ExplicacaoFator = {
    chave: 'disputa',
    nivel: disputa.nivel,
    frase: fraseDisputa(disputa.nivel, disputa.vendedores, disputa.frete),
    regua: regua(0, 40, [DISPUTA.vendedoresPoucos, DISPUTA.vendedoresMuitos], disputa.vendedores, true),
    destravar: disputa.nivel === 'bom' ? null : destravarDisputa(disputa.vendedores, disputa.frete),
  };

  let fatorTracaoExplicacao: ExplicacaoFator | null = null;
  if (!semVendas) {
    const t = nivelTracao(painel, vendas);
    fatores.push({ chave: 'tracao', label: 'Tração', nivel: t.nivel, detalhe: t.detalhe });
    fatorTracaoExplicacao = {
      chave: 'tracao',
      nivel: t.nivel,
      frase: fraseTracao(t.nivel, t.porVendedor),
      regua: regua(0, 300_000, [TRACAO.media, TRACAO.boa], Math.round(t.porVendedor), false),
      destravar: t.nivel === 'bom' ? null : destravarTracao(t.nivel),
    };
  }

  const soma = fatores.reduce((acc, f) => acc + PONTOS[f.nivel], 0);
  const maximo = fatores.length * 2;
  // Demanda ruim é gate absoluto: sem prova de compra não existe oportunidade, por melhores que
  // sejam os outros fatores. Fora isso, a escala é proporcional ao nº de fatores disponíveis,
  // para o fallback sem vendas (máx. 4) não virar "baixa" só por ter um fator a menos.
  const gateDemanda = demanda.nivel === 'ruim';
  const nivel: NivelVeredito = gateDemanda || soma <= maximo / 3 ? 'baixa'
    : soma >= maximo - 1 ? 'alta' : 'media';

  const marca = alertaMarca(painel);
  let fatorMarcaExplicacao: ExplicacaoFator | null = null;
  if (marca) {
    fatorMarcaExplicacao = {
      chave: 'marca',
      nivel: marca.nivel,
      frase: fraseMarca(marca.nivel, marca.pct),
      regua: regua(0, 100, [MARCA.aberto, MARCA.dominado], Math.round(marca.pct), true),
      destravar: marca.nivel === 'bom' ? null : destravarMarca(marca.nivel, marca.pct),
    };
  }

  const acaoBase = ACAO[nivel];
  const acao = gateDemanda
    ? `Demanda insuficiente derruba o veredito para baixa por conta própria, independente dos outros fatores. ${acaoBase}`
    : acaoBase;

  const explicacao: Explicacao = {
    pontuacao: { soma, maximo },
    gateDemanda,
    fatores: [fatorDemandaExplicacao, fatorDisputaExplicacao, fatorTracaoExplicacao, fatorMarcaExplicacao]
      .filter((f): f is ExplicacaoFator => f != null),
    acao,
  };

  return {
    nivel,
    titulo: TITULOS[nivel],
    motivo: montarMotivo(nivel, fatores, semVendas),
    fatores,
    marca,
    semVendas,
    explicacao,
  };
}

/**
 * Dados fora do score, pra seção "Contexto do nicho" do "Saiba mais": ticket médio, % Full,
 * % internacionais (amostra de vendas) e mediana de preço das fichas do painel oficial.
 */
export function contextoNicho(painel: PainelSonar, vendas: PainelVendasSonar | null): ContextoItem[] {
  const itens: ContextoItem[] = [];
  const precos = painel.fichas
    .map((f) => f.preco?.mediana)
    .filter((p): p is number => p != null)
    .sort((a, b) => a - b);
  if (precos.length > 0) {
    const meio = Math.floor(precos.length / 2);
    const mediana = precos.length % 2 === 1 ? precos[meio] : (precos[meio - 1] + precos[meio]) / 2;
    itens.push({ rotulo: 'Preço mediano das fichas', valor: fmtBRL(mediana) });
  }
  if (vendas?.configurado) {
    const rx = vendas.raio_x;
    if (rx.ticket_medio != null) itens.push({ rotulo: 'Ticket médio da amostra', valor: fmtBRL(rx.ticket_medio) });
    if (vendas.itens_analisados > 0) {
      itens.push({ rotulo: '% Full na amostra', valor: pct((rx.full / vendas.itens_analisados) * 100) });
      itens.push({ rotulo: '% internacionais na amostra', valor: pct((rx.internacionais / vendas.itens_analisados) * 100) });
    }
  }
  return itens;
}

// ================= Veredito v2 (ADR-0127/D10-D12): a unidade é o ANÚNCIO =======================
// A tabela do Sonar deixou de listar fichas de catálogo e passou a listar anúncios reais vindos da
// Apify; o veredito é recalculado sobre eles. Sem painel de fichas e SEM fallback sem Apify (D16).
// Nasce ao lado do veredito antigo — a página ainda usa `calcularVeredito` até a Task 11.
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
  /** true quando a trava de cobertura (D10) tirou Disputa e Tração da conta: o veredito saiu com
   *  meia informação e se DECLARA parcial, em vez de rebaixar em silêncio. Falta de dado não é
   *  sinal de negócio. */
  parcial: boolean;
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
  const analisados = itens.length;
  return {
    analisados,
    nomeados,
    distintos: rotulos.size,
    cobertura: analisados > 0 ? nomeados / analisados : 0,
    faturamento,
  };
}

/** % Full da amostra. `null` quando NENHUM anúncio traz envio identificado — aí o termo sai da
 *  regra de Disputa em vez de virar 0% (LOUD: ausência não é dado). */
function fullPctAmostra(vendas: PainelVendasSonar): number | null {
  if (vendas.itens_analisados === 0) return null;
  const itens = itensDaAmostra(vendas);
  if (itens.length > 0 && itens.every((i) => i.full == null)) return null;
  return (vendas.raio_x.full / vendas.itens_analisados) * 100;
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
  // estoque em CD. Com `fullPct` null o termo simplesmente sai dos dois lados da regra — não vira
  // 0% (que empurraria para 'bom') nem bloqueia o 'bom' (que puniria a ausência).
  const nivel: NivelFator = pulverizacao <= DISPUTA_V2.pulverizacaoConcentrada
    || (fullPct != null && fullPct >= DISPUTA_V2.fullMuito)
    ? 'ruim'
    : pulverizacao >= DISPUTA_V2.pulverizacaoAberta && (fullPct == null || fullPct <= DISPUTA_V2.fullPouco)
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

/** Marca vira % da AMOSTRA de anúncios com loja oficial (antes era % de fichas). Segue fora da
 *  pontuação — alerta de risco de moderação, não nota. */
function alertaMarcaV2(vendas: PainelVendasSonar): { nivel: NivelFator; detalhe: string; pct: number } | null {
  if (vendas.itens_analisados === 0) return null;
  const p = (vendas.raio_x.lojas_oficiais / vendas.itens_analisados) * 100;
  const detalhe = `${pct(p)} da amostra com loja oficial`;
  if (p > MARCA.dominado) return { nivel: 'ruim', detalhe, pct: p };
  if (p >= MARCA.aberto) return { nivel: 'medio', detalhe, pct: p };
  return { nivel: 'bom', detalhe, pct: p };
}

function montarMotivoAnuncios(nivel: NivelVeredito, fatores: Fator[], parcial: boolean): string {
  if (parcial && nivel !== 'baixa') {
    return 'Menos da metade dos anúncios traz rótulo de loja — não deu para avaliar a concorrência do nicho.';
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
  const parcial = disputa == null || tracao == null;

  const fatores: Fator[] = [{ chave: 'demanda', label: 'Demanda', nivel: demanda.nivel, detalhe: demanda.detalhe }];
  if (disputa) fatores.push({ chave: 'disputa', label: 'Disputa', nivel: disputa.nivel, detalhe: disputa.detalhe });
  if (tracao) fatores.push({ chave: 'tracao', label: 'Tração', nivel: tracao.nivel, detalhe: tracao.detalhe });

  const soma = fatores.reduce((acc, f) => acc + PONTOS[f.nivel], 0);
  const maximo = fatores.length * 2; // escala proporcional (ADR-0124 §4) absorve a trava D10
  const gateDemanda = demanda.nivel === 'ruim';
  const nivel: NivelVeredito = gateDemanda || soma <= maximo / 3 ? 'baixa'
    : soma >= maximo - 1 && fatores.length >= PISO_FATORES_ALTA ? 'alta'
      : 'media';

  const marca = alertaMarcaV2(vendas);

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
      frase: fraseDisputaV2(disputa.nivel, sub, disputa.pulverizacao, disputa.fullPct),
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
  if (parcial) {
    // Trava D10 visível no "Saiba mais": indisponível ≠ ruim, e o veredito diz isso em voz alta.
    fatoresExplicacao.push({
      chave: 'disputa',
      nivel: 'medio',
      frase: `Só ${sub.nomeados} de ${sub.analisados} anúncios da amostra trazem rótulo de loja (mínimo: ${Math.round(COBERTURA_MINIMA * 100)}%) — sem base para medir a concorrência do nicho. Disputa e Tração saíram da pontuação; não viraram nota ruim, e por isso este veredito é parcial.`,
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

  const acaoBase = ACAO[nivel];
  const acao = gateDemanda
    ? `Demanda insuficiente derruba o veredito para baixa por conta própria, independente dos outros fatores. ${acaoBase}`
    : parcial
      ? `Avaliação parcial: sem rótulo de loja na maioria dos anúncios, não foi possível avaliar a concorrência do nicho — o veredito saiu só com a Demanda. ${acaoBase}`
      : acaoBase;

  return {
    nivel,
    titulo: TITULOS[nivel],
    motivo: montarMotivoAnuncios(nivel, fatores, parcial),
    fatores,
    marca,
    parcial,
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
