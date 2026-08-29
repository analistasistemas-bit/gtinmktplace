// DRE da seção 6 do relatório da Análise PubliAI (ADR-0148, fatia 1).
//
// Este módulo **não calcula dinheiro**. Ele decide SE a conta pode ser feita (o guard de
// proveniência da D-28) e delega a aritmética a `calcularSimulacaoML()`, como manda a D-15 da
// ADR-0141: o projeto já tem quatro superfícies calculando margem e não terá uma quinta.
//
// Não há cenários, sensibilidade nem ROI nesta fatia: os 5 cenários exigem 5 cotações e nunca
// foram enumerados, e o ROI não tem definição de quantidade, capital ou horizonte (Spike 040).

import { calcularSimulacaoML, type CotacoesOficiaisPorModalidade } from './calculadora-ml';
import { provenienciaDaTarifa, type Tarifa } from './tarifa';

export type OrigemProduto = 'nacional' | 'importado';

export interface EntradaDreSonar {
  precoAnuncio: number;
  /** Custo do operador. `null` enquanto ele não digitou — o produto é do concorrente. */
  custoProduto: number | null;
  /** Sem origem não há alíquota, e alíquota não se presume (ADR-0055 / ADR-0148 D-6). */
  origem: OrigemProduto | null;
  aliquotas: { nacional: number; importado: number } | null;
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
    /** O que NÃO entrou na conta, declarado na tela (ADR-0148 D-5). */
    forasDoCalculo: string[];
  }
  | { estado: 'indisponivel'; motivo: string };

/** Declarado, não silencioso: o formulário desta fatia não pede estes três, e eles entram como
 *  zero em `EntradaCalculadoraML` — zero que infla o lucro se ninguém disser que está lá. */
const FORA_DO_CALCULO = [
  'custos fixos do seu negócio',
  'custos variáveis por venda',
  'rebate ou bonificação do fornecedor',
];

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

  if (e.tarifa == null) {
    return { estado: 'indisponivel', motivo: 'o Mercado Livre não respondeu a cotação de comissão e frete' };
  }

  // O guard da D-28: fora de `official` não se calcula, e o motivo do ML é repassado ao operador.
  const { proveniencia, motivo } = provenienciaDaTarifa(e.tarifa);
  if (proveniencia !== 'official') {
    return { estado: 'indisponivel', motivo: motivo ?? 'os números da cotação não são oficiais' };
  }

  const aliquotaPct = e.origem === 'importado' ? e.aliquotas.importado : e.aliquotas.nacional;

  // A cotação já veio oficial do ML; o frete é o mesmo nas duas modalidades (ver _shared/ml/frete).
  const cotacoes: CotacoesOficiaisPorModalidade = {
    origem: 'official',
    classico: {
      percentualComissaoPct: e.tarifa.classico.percentual,
      taxaFixa: e.tarifa.classico.fixa,
      comissaoTotal: e.tarifa.classico.comissao,
      frete: e.tarifa.frete,
      proveniencia: 'official',
    },
    premium: {
      percentualComissaoPct: e.tarifa.premium.percentual,
      taxaFixa: e.tarifa.premium.fixa,
      comissaoTotal: e.tarifa.premium.comissao,
      frete: e.tarifa.frete,
      proveniencia: 'official',
    },
  };

  const simulacao = calcularSimulacaoML({
    precoVenda: e.precoAnuncio,
    custoProduto: e.custoProduto,
    aliquotaImpostoPct: aliquotaPct,
    // Zeros declarados em `FORA_DO_CALCULO`, não zeros silenciosos (ADR-0148 D-5).
    custosFixos: 0,
    custosVariaveis: 0,
    rebate: 0,
    margemAlvoPct: 0,
  }, cotacoes);

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
    forasDoCalculo: FORA_DO_CALCULO,
  };
}
