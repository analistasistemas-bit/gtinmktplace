// Sem importar `listing-prices.ts`: ele já importa o tipo daqui, e o par viraria import circular.
import { piorProveniencia, type Proveniencia, type ValorComProveniencia } from './proveniencia.ts';

export interface ListingPriceML {
  sale_fee_amount: number;
  sale_fee_details?: { percentage_fee?: number; fixed_fee?: number };
}

export interface TarifaTipo {
  comissao: number;
  percentual: number;
  fixa: number;
  recebe: number;
}

export interface Tarifa {
  classico: TarifaTipo;
  premium: TarifaTipo;
  /** Frete que o vendedor absorve (frete grátis ao comprador). 0 quando o comprador paga. */
  frete: number;
}

function arredondar2(n: number): number {
  return Math.round(n * 100) / 100;
}

function tipo(preco: number, lp: ListingPriceML, frete: number): TarifaTipo {
  const comissao = lp.sale_fee_amount ?? 0;
  return {
    comissao,
    percentual: lp.sale_fee_details?.percentage_fee ?? 0,
    fixa: lp.sale_fee_details?.fixed_fee ?? 0,
    recebe: arredondar2(preco - comissao - frete),
  };
}

/**
 * Decompõe a resposta de /sites/MLB/listing_prices (Clássico e Premium) num resumo
 * de quanto o operador recebe por venda. `recebe = preço − comissão − frete do vendedor`
 * (o frete é o mesmo para Clássico/Premium; ver _shared/ml/frete.ts).
 */
export function montarTarifa(
  preco: number,
  classicoML: ListingPriceML,
  premiumML: ListingPriceML,
  frete = 0,
): Tarifa {
  return {
    classico: tipo(preco, classicoML, frete),
    premium: tipo(preco, premiumML, frete),
    frete: arredondar2(frete),
  };
}

/**
 * Variante com proveniência, para a DRE (ADR-0148 D-2). A tarifa vale a PIOR proveniência entre
 * as duas modalidades e o frete: comissão oficial com frete estimado não é número oficial.
 */
export function montarTarifaComProveniencia(
  preco: number,
  classicoML: ListingPriceML,
  premiumML: ListingPriceML,
  frete: ValorComProveniencia<number>,
): ValorComProveniencia<Tarifa> {
  const partes = [
    provenienciaDaListingPrice(classicoML, 'Clássico'),
    provenienciaDaListingPrice(premiumML, 'Premium'),
    frete,
  ];
  return {
    valor: montarTarifa(preco, classicoML, premiumML, frete.valor),
    ...piorProveniencia(...partes),
  };
}

/** `sale_fee_amount` e o bloco de detalhes viram zero no `tipo()` acima — aqui isso é declarado. */
function provenienciaDaListingPrice(
  lp: ListingPriceML,
  modalidade: string,
): { proveniencia: Proveniencia; motivo?: string } {
  if (lp?.sale_fee_amount == null) {
    return {
      proveniencia: 'estimated',
      motivo: `o Mercado Livre respondeu sem \`sale_fee_amount\` para o ${modalidade} — a comissão não veio`,
    };
  }
  const d = lp.sale_fee_details;
  if (!d || d.percentage_fee == null || d.fixed_fee == null) {
    return {
      proveniencia: 'estimated',
      motivo: `o Mercado Livre respondeu sem \`sale_fee_details\` para o ${modalidade} — a comissão não veio detalhada`,
    };
  }
  return { proveniencia: 'official' };
}
