// DRE da seção 6 do relatório da Análise PubliAI (ADR-0148, fatia 1).
//
// Este módulo **não calcula dinheiro**. Ele decide SE a conta pode ser feita (o guard de
// proveniência da D-28) e delega a aritmética a `calcularSimulacaoML()`, como manda a D-15 da
// ADR-0141: o projeto já tem quatro superfícies calculando margem e não terá uma quinta.
//
// Não há cenários, sensibilidade nem ROI nesta fatia: os 5 cenários exigem 5 cotações e nunca
// foram enumerados, e o ROI não tem definição de quantidade, capital ou horizonte (Spike 040).

import {
  calcularPesoUtilizado,
  calcularSimulacaoML,
  type CotacoesOficiaisPorModalidade,
  type DimensoesProduto,
  type PesoUtilizado,
} from './calculadora-ml';
import { provenienciaDaTarifa, type Tarifa } from './tarifa';

export type OrigemProduto = 'nacional' | 'importado';

export interface EntradaDreSonar {
  precoAnuncio: number;
  /** Custo do operador. `null` enquanto ele não digitou — o produto é do concorrente. */
  custoProduto: number | null;
  /** Sem origem não há alíquota, e alíquota não se presume (ADR-0055 / ADR-0148 D-6). */
  origem: OrigemProduto | null;
  aliquotas: { nacional: number; importado: number } | null;
  /**
   * Pacote informado pelo operador (D-16). `null` enquanto ele não digitou.
   *
   * Não é campo opcional: sem ele o `calcular-tarifa-ml` cai no pacote padrão de 16×11×6 cm /
   * 300 g, a proveniência do frete vira `partial` e o guard da D-28 recusa **sempre**. A seção 6
   * nascia morta no Sonar, onde o produto é do concorrente e nunca tem dimensão nossa.
   */
  dimensoes: DimensoesProduto | null;
  /** `null` quando o ML não respondeu a cotação. */
  tarifa: Tarifa | null;
}

export type DreSonar =
  | {
    estado: 'calculada';
    receita: number;
    comissao: number;
    frete: number;
    imposto: number;
    aliquotaPct: number;
    custoProduto: number;
    lucro: number;
    margemPct: number;
    /** Peso físico × cubado, e o taxável que o ML usa para cobrar (D-16). */
    peso: PesoUtilizado;
    /** Sai da cotação (`frete > 0`), não de regra nossa sobre faixa de preço. */
    vendedorPagaFrete: boolean;
    /** O que NÃO entrou na conta, declarado na tela (ADR-0148 D-5). */
    forasDoCalculo: string[];
  }
  | { estado: 'indisponivel'; motivo: string };

/**
 * Preços que não são observados no mercado: eles saem da cotação da ÂNCORA, porque não há como
 * cotar um preço antes de conhecê-lo (ADR-0149 D-3). São **projeção** — a tela os marca assim, e
 * cada um é recotado no próprio valor antes de virar número exibido.
 *
 * `margemAlvoPct` nulo não vira meta presumida: sem meta, não há preço-alvo.
 */
export function precosDerivadosDre(
  e: EntradaDreSonar,
  margemAlvoPct: number | null,
): { pontoEquilibrio: number | null; precoAlvo: number | null } {
  const base = montarDreSonar(e);
  if (base.estado !== 'calculada' || e.tarifa == null) {
    return { pontoEquilibrio: null, precoAlvo: null };
  }
  const simulacao = calcularSimulacaoML({
    precoVenda: e.precoAnuncio,
    custoProduto: base.custoProduto,
    aliquotaImpostoPct: base.aliquotaPct,
    dimensoes: e.dimensoes ?? undefined,
    custosFixos: 0,
    custosVariaveis: 0,
    rebate: 0,
    margemAlvoPct: margemAlvoPct ?? 0,
  }, cotacoesDaTarifa(e.tarifa));

  const classico = simulacao.modalidades.classico;
  return {
    pontoEquilibrio: classico?.precoEquilibrio.valor ?? null,
    precoAlvo: margemAlvoPct == null ? null : (classico?.precoAlvo.valor ?? null),
  };
}

/** Declarado, não silencioso: o formulário desta fatia não pede estes três, e eles entram como
 *  zero em `EntradaCalculadoraML` — zero que infla o lucro se ninguém disser que está lá. */
const FORA_DO_CALCULO = [
  'custos fixos do seu negócio',
  'custos variáveis por venda',
  'rebate ou bonificação do fornecedor',
];

/** Adapta a tarifa já verificada como `official` para o formato do motor. O frete é o mesmo nas
 *  duas modalidades (ver `_shared/ml/frete.ts`). */
function cotacoesDaTarifa(tarifa: Tarifa): CotacoesOficiaisPorModalidade {
  return {
    origem: 'official',
    classico: {
      percentualComissaoPct: tarifa.classico.percentual,
      taxaFixa: tarifa.classico.fixa,
      comissaoTotal: tarifa.classico.comissao,
      frete: tarifa.frete,
      proveniencia: 'official',
    },
    premium: {
      percentualComissaoPct: tarifa.premium.percentual,
      taxaFixa: tarifa.premium.fixa,
      comissaoTotal: tarifa.premium.comissao,
      frete: tarifa.frete,
      proveniencia: 'official',
    },
  };
}

export function montarDreSonar(e: EntradaDreSonar): DreSonar {
  // O que o operador ainda não digitou vem PRIMEIRO: enquanto falta custo ou origem, dizer "o
  // Mercado Livre não respondeu" seria culpar o ML por um campo em branco — e mandaria o operador
  // esperar uma cotação que não resolveria nada.
  if (e.custoProduto == null) {
    return { estado: 'indisponivel', motivo: 'informe o custo do produto — sem ele não há lucro a calcular' };
  }
  // Imposto nunca defaulta: sem origem, sem alíquota, sem DRE (mesmo padrão de
  // `montarAliquotaResolver` em custos.ts).
  if (e.origem == null || e.aliquotas == null) {
    return { estado: 'indisponivel', motivo: 'informe a origem do produto — a alíquota de imposto depende dela e não é presumida' };
  }

  // D-16, e ANTES da tarifa de propósito: sem dimensões a cotação sai do pacote padrão e volta
  // `partial` sempre. Dizer "o frete usou um pacote padrão" mandaria o operador esperar o ML
  // resolver um campo que só ele pode preencher.
  if (e.dimensoes == null) {
    return { estado: 'indisponivel', motivo: 'informe o peso e as dimensões do pacote — sem eles o frete sai de um pacote padrão e não vale como número oficial' };
  }
  // Reusa a validação do próprio motor em vez de repeti-la aqui: uma segunda cópia das regras
  // seria a segunda fonte de verdade que a D-15 existe para evitar. Dimensão inválida chega de
  // verdade — 18 anúncios em produção têm 0,10 cm.
  const peso = pesoOuNulo(e.dimensoes);
  if (peso == null) {
    return { estado: 'indisponivel', motivo: 'as dimensões e o peso precisam ser maiores que zero' };
  }

  if (e.tarifa == null) {
    return { estado: 'indisponivel', motivo: 'o Mercado Livre não respondeu a cotação de comissão e frete' };
  }

  // O guard da D-28: fora de `official` não se calcula, e o motivo do ML é repassado ao operador.
  const { proveniencia, motivo } = provenienciaDaTarifa(e.tarifa);
  if (proveniencia !== 'official') {
    return { estado: 'indisponivel', motivo: motivo ?? 'os números da cotação não são oficiais' };
  }

  const aliquotaPct = e.origem === 'importado' ? e.aliquotas.importado : e.aliquotas.nacional;

  const simulacao = calcularSimulacaoML({
    precoVenda: e.precoAnuncio,
    custoProduto: e.custoProduto,
    aliquotaImpostoPct: aliquotaPct,
    dimensoes: e.dimensoes,
    // Zeros declarados em `FORA_DO_CALCULO`, não zeros silenciosos (ADR-0148 D-5).
    custosFixos: 0,
    custosVariaveis: 0,
    rebate: 0,
    margemAlvoPct: 0,
  }, cotacoesDaTarifa(e.tarifa));

  const classico = simulacao.modalidades.classico;
  if (classico == null) {
    return { estado: 'indisponivel', motivo: 'não foi possível montar a decomposição de custos para o Clássico' };
  }

  return {
    estado: 'calculada',
    receita: e.precoAnuncio,
    comissao: classico.custos.comissao,
    frete: classico.custos.frete,
    imposto: classico.custos.imposto,
    aliquotaPct,
    custoProduto: classico.custos.custoProduto,
    lucro: classico.lucro,
    margemPct: classico.margemPct,
    peso,
    // O ML só devolve `list_cost` quando o vendedor absorve o frete (ver `_shared/ml/frete.ts`);
    // frete 0 é "o comprador paga", já validado como `official` pela D-28.
    vendedorPagaFrete: classico.custos.frete > 0,
    forasDoCalculo: FORA_DO_CALCULO,
  };
}

/** `calcularPesoUtilizado` lança `RangeError` em dimensão não-positiva. A seção 6 recebe digitação
 *  livre do operador, então a exceção vira recusa — nunca uma árvore do React derrubada. */
function pesoOuNulo(dimensoes: DimensoesProduto): PesoUtilizado | null {
  try {
    return calcularPesoUtilizado(dimensoes);
  } catch {
    return null;
  }
}
