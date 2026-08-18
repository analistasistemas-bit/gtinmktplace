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
