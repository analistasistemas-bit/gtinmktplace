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
import { fmtMilhar } from './formato';
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

export interface Veredito {
  nivel: NivelVeredito;
  titulo: string;
  motivo: string;
  fatores: Fator[];
  marca: AlertaMarca | null;
  /** true quando as vendas não vieram (Apify fora/sem token) e a demanda caiu no proxy de visitas. */
  semVendas: boolean;
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

function nivelDemanda(vendas: PainelVendasSonar): { nivel: NivelFator; detalhe: string } {
  const liquidez = vendas.itens_analisados > 0
    ? vendas.itens_com_vendas / vendas.itens_analisados
    : 0;
  const detalhe = `${pct(liquidez * 100)} dos anúncios vendem`;
  if (vendas.vendas_totais < DEMANDA.vendasMinimas || liquidez < DEMANDA.liquidezRuim) {
    return { nivel: 'ruim', detalhe };
  }
  if (liquidez >= DEMANDA.liquidezBoa && vendas.vendas_totais >= DEMANDA.vendasBoas) {
    return { nivel: 'bom', detalhe };
  }
  return { nivel: 'medio', detalhe };
}

function nivelDemandaPorVisitas(painel: PainelSonar): { nivel: NivelFator; detalhe: string } {
  const v = painel.agregado.visitas_30d_total;
  const detalhe = `${fmtMilhar(v, 1)} visitas em 30 dias`;
  if (v < VISITAS.minimas) return { nivel: 'ruim', detalhe };
  if (v >= VISITAS.boas) return { nivel: 'bom', detalhe };
  return { nivel: 'medio', detalhe };
}

function nivelDisputa(painel: PainelSonar): { nivel: NivelFator; detalhe: string } {
  const vendedores = painel.agregado.vendedores_distintos;
  const frete = painel.agregado.frete_gratis_pct;
  const detalhe = `${vendedores} vendedores · ${pct(frete)} com frete grátis`;
  // Frete grátis alto sinaliza vendedor estruturado (Full), não um campo amador — entrar custa mais.
  if (vendedores > DISPUTA.vendedoresMuitos || frete >= DISPUTA.freteMuito) {
    return { nivel: 'ruim', detalhe };
  }
  if (vendedores <= DISPUTA.vendedoresPoucos && frete <= DISPUTA.fretePouco) {
    return { nivel: 'bom', detalhe };
  }
  return { nivel: 'medio', detalhe };
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
function alertaMarca(painel: PainelSonar): AlertaMarca | null {
  const ativas = painel.fichas.filter((f) => f.ofertas > 0);
  if (ativas.length === 0) return null;
  const comOficial = ativas.filter((f) => f.vendedores.some((v) => v.loja_oficial)).length;
  const p = (comOficial / ativas.length) * 100;
  const detalhe = `${pct(p)} das fichas com loja oficial`;
  if (p > MARCA.dominado) return { nivel: 'ruim', detalhe };
  if (p >= MARCA.aberto) return { nivel: 'medio', detalhe };
  return { nivel: 'bom', detalhe };
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

  const demanda = semVendas ? nivelDemandaPorVisitas(painel) : nivelDemanda(vendas!);
  const fatores: Fator[] = [
    { chave: 'demanda', label: 'Demanda', nivel: demanda.nivel, detalhe: demanda.detalhe },
    { chave: 'disputa', label: 'Disputa', nivel: disputa.nivel, detalhe: disputa.detalhe },
  ];
  if (!semVendas) {
    const t = nivelTracao(painel, vendas!);
    fatores.push({ chave: 'tracao', label: 'Tração', nivel: t.nivel, detalhe: t.detalhe });
  }

  const soma = fatores.reduce((acc, f) => acc + PONTOS[f.nivel], 0);
  const maximo = fatores.length * 2;
  // Demanda ruim é gate absoluto: sem prova de compra não existe oportunidade, por melhores que
  // sejam os outros fatores. Fora isso, a escala é proporcional ao nº de fatores disponíveis,
  // para o fallback sem vendas (máx. 4) não virar "baixa" só por ter um fator a menos.
  const nivel: NivelVeredito = demanda.nivel === 'ruim' || soma <= maximo / 3 ? 'baixa'
    : soma >= maximo - 1 ? 'alta' : 'media';

  return {
    nivel,
    titulo: TITULOS[nivel],
    motivo: montarMotivo(nivel, fatores, semVendas),
    fatores,
    marca: alertaMarca(painel),
    semVendas,
  };
}
