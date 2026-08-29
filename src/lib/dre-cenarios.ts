// Cenários da DRE — cinco PREÇOS de venda, cada um com a sua cotação (ADR-0149). Função pura.
//
// Não são testes de estresse: são preços a que o operador poderia vender. E nenhum reaproveita a
// cotação de outro, porque comissão e frete do ML têm degraus por faixa — extrapolar erra com
// aparência de precisão cirúrgica (Spike 040).
//
// O preço do buy-box NÃO é um dos cinco: ele não é obtenível (Spike 049, `buy_box_winner` null em
// 40 de 40). O lugar dele é do anúncio que mais vende.

import type { DimensoesProduto, ModalidadeML } from './calculadora-ml';
import { montarDreSonar, type DreSonar, type OrigemProduto } from './dre-sonar';
import type { Tarifa } from './tarifa';

export type ChaveCenario =
  | 'mais_barato'
  | 'ponto_equilibrio'
  | 'medio_do_nicho'
  | 'anuncio_que_mais_vende'
  | 'preco_alvo';

export interface CenarioPreco {
  chave: ChaveCenario;
  rotulo: string;
  preco: number;
  /** Derivado de uma cotação anterior, não observado no mercado (ADR-0149 D-3). */
  projecao: boolean;
}

export interface PrecosBrutos {
  maisBarato: number | null;
  medioDoNicho: number | null;
  anuncioQueMaisVende: number | null;
  precoAlvo: number | null;
  pontoEquilibrio: number | null;
}

const DEFINICAO: Array<{ chave: ChaveCenario; rotulo: string; campo: keyof PrecosBrutos; projecao: boolean }> = [
  { chave: 'mais_barato', rotulo: 'mais barato da amostra', campo: 'maisBarato', projecao: false },
  { chave: 'ponto_equilibrio', rotulo: 'ponto de equilíbrio', campo: 'pontoEquilibrio', projecao: true },
  { chave: 'medio_do_nicho', rotulo: 'preço médio do nicho', campo: 'medioDoNicho', projecao: false },
  { chave: 'anuncio_que_mais_vende', rotulo: 'anúncio que mais vende', campo: 'anuncioQueMaisVende', projecao: false },
  { chave: 'preco_alvo', rotulo: 'seu preço-alvo', campo: 'precoAlvo', projecao: true },
];

/**
 * Os cenários existentes, do mais barato ao mais caro. Preço ausente é **omitido** — nunca vira
 * zero — e preços iguais colapsam numa linha só, porque duas linhas idênticas sugerem duas
 * decisões diferentes onde há uma.
 */
export function precosDosCenarios(p: PrecosBrutos): CenarioPreco[] {
  const vistos = new Set<number>();
  const cenarios: CenarioPreco[] = [];
  for (const d of DEFINICAO) {
    const preco = p[d.campo];
    if (preco == null || !(preco > 0) || vistos.has(preco)) continue;
    vistos.add(preco);
    cenarios.push({ chave: d.chave, rotulo: d.rotulo, preco, projecao: d.projecao });
  }
  return cenarios.sort((a, b) => a.preco - b.preco);
}

export interface CotacaoPorPreco {
  preco: number;
  /** `null` quando o ML não respondeu para aquele preço. */
  tarifa: Tarifa | null;
}

export interface CenarioComDre extends CenarioPreco {
  dre: DreSonar;
}

/**
 * Casa cada preço com a cotação DAQUELE preço e monta a DRE de cada um. Um cenário que recusa
 * (cotação ausente ou não-oficial) recusa sozinho — os demais continuam (ADR-0149 D-5).
 */
export function montarCenariosDre(
  cenarios: CenarioPreco[],
  cotacoes: CotacaoPorPreco[],
  entrada: {
    custoProduto: number | null;
    origem: OrigemProduto | null;
    aliquotas: { nacional: number; importado: number } | null;
    /** O mesmo pacote nos cinco preços: muda o preço, não o produto (D-16). */
    dimensoes: DimensoesProduto | null;
    /** A mesma modalidade nos cinco: é uma escolha de anúncio, não de preço. */
    modalidade: ModalidadeML;
  },
): CenarioComDre[] {
  const porPreco = new Map(cotacoes.map((c) => [c.preco, c.tarifa]));
  return cenarios.map((c) => ({
    ...c,
    dre: montarDreSonar({
      precoAnuncio: c.preco,
      custoProduto: entrada.custoProduto,
      origem: entrada.origem,
      aliquotas: entrada.aliquotas,
      dimensoes: entrada.dimensoes,
      modalidade: entrada.modalidade,
      // `undefined` (preço nunca cotado) e `null` (cotação falhou) caem no mesmo lugar: sem número.
      tarifa: porPreco.get(c.preco) ?? null,
    }),
  }));
}

export interface CapitalDoLote {
  capitalImobilizado: number;
  lucroTotal: number;
  /**
   * É o **retorno sobre o custo** — o mesmo número do markup. A quantidade cancela na razão
   * `(lucro × Q) ÷ (custo × Q)`, então não existe um "ROI do lote" diferente disto (ADR-0149 D-4).
   * O que a quantidade acrescenta são os dois absolutos acima. `null` quando não há custo.
   */
  retornoSobreCustoPct: number | null;
}

function arredondar(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * O que sai do caixa e o que volta, para uma compra de `quantidade` unidades.
 * Quantidade em branco **não vira 1** (ADR-0149 D-6): sem ela não há lote a calcular.
 */
export function capitalDoLote(
  quantidade: number | null,
  custoUnitario: number,
  lucroUnitario: number,
): CapitalDoLote | null {
  if (quantidade == null || !(quantidade > 0)) return null;
  return {
    capitalImobilizado: arredondar(custoUnitario * quantidade),
    lucroTotal: arredondar(lucroUnitario * quantidade),
    retornoSobreCustoPct: custoUnitario > 0 ? arredondar((lucroUnitario / custoUnitario) * 100) : null,
  };
}
