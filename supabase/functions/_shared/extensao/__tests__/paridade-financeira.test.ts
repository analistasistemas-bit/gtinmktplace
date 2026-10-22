// Paridade financeira (ADR-0189 Task 11A): a "Minha margem" da extensão bate com a Viabilidade
// (`analisar-item-viabilidade` + `liquidoNoMercado`/`calcularMarkup`) e com o Pulse (`margemEstimada`)
// dentro de R$ 0,05, partindo do MESMO listing_prices do ML.
import { describe, expect, it } from 'vitest';
import { calcularMinhaMargem, custoDoPacote, fatorDoPacote } from '../margem.ts';
import { comissaoDaListingPrice } from '../../../extensao/roteamento.ts';
import { comissaoDe } from '../../ml/listing-prices.ts';
import type { ListingPriceML } from '../../ml/tarifa.ts';
import { liquidoNoMercado } from '../../../../../src/lib/viabilidade';
import { calcularMarkup } from '../../../../../src/lib/markup';
import { margemEstimada } from '../../../../../src/lib/pulse-margem';

const TOL = 0.05;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Caso {
  nome: string;
  preco: number;
  /** resposta do /sites/MLB/listing_prices (sale_fee_amount pode faltar: fallback antigo). */
  lp: Partial<ListingPriceML>;
  /** preço em que o listing_prices foi consultado (default = preco). */
  precoConsultado?: number;
  frete: number;
  aliquotaPct: number;
  custoSku: number;
  /** SKUs por anúncio (kit). */
  fator: number;
  /** Viabilidade lê `sale_fee_amount ?? 0`: sem o valor pronto ela não desconta comissão (fallback antigo). */
  viabilidadeDiverge?: boolean;
}

const lp = (pct: number, fixa: number, fee?: number): Partial<ListingPriceML> => ({
  ...(fee === undefined ? {} : { sale_fee_amount: fee }),
  sale_fee_details: { percentage_fee: pct, fixed_fee: fixa },
});

const CASOS: Caso[] = [
  { nome: 'Clássico abaixo da faixa (fixa 6,75), frete 0, nacional 8%', preco: 59.9, lp: lp(12, 6.75, 13.94), frete: 0, aliquotaPct: 8, custoSku: 20, fator: 1 },
  { nome: 'Premium abaixo da faixa (fixa 6,75), frete 0, nacional 8%', preco: 59.9, lp: lp(17, 6.75, 16.93), frete: 0, aliquotaPct: 8, custoSku: 20, fator: 1 },
  { nome: 'Clássico acima da faixa, frete > 0, importado 16%, kit 2', preco: 129.9, lp: lp(12, 0, 15.59), frete: 22.45, aliquotaPct: 16, custoSku: 40, fator: 2 },
  { nome: 'Premium acima da faixa, frete > 0, importado 16%, kit 2', preco: 129.9, lp: lp(17, 0, 22.08), frete: 22.45, aliquotaPct: 16, custoSku: 40, fator: 2 },
  { nome: 'Premium, alíquota configurada 6,5%, centavos quebrados', preco: 37.37, lp: lp(16.5, 6.25, 12.42), frete: 0, aliquotaPct: 6.5, custoSku: 11.11, fator: 1 },
  { nome: 'Clássico, preço simulado ≠ consultado (cai em percentual + fixa)', preco: 99.9, precoConsultado: 89.9, lp: lp(12, 0, 10.79), frete: 18.9, aliquotaPct: 8, custoSku: 30, fator: 1, viabilidadeDiverge: true },
  { nome: 'Clássico sem sale_fee_amount, frete > 0, nacional 8%', preco: 89.9, lp: lp(12, 0), frete: 18.9, aliquotaPct: 8, custoSku: 30, fator: 1, viabilidadeDiverge: true },
];

function extensao(c: Caso) {
  const comissao = comissaoDaListingPrice(c.lp as ListingPriceML, c.precoConsultado ?? c.preco);
  const tipo = { comissao, frete: { estado: 'ok' as const, valor: c.frete } };
  const m = calcularMinhaMargem({
    preco: c.preco,
    aliquotaPct: { estado: 'ok', valor: c.aliquotaPct },
    custoPacote: custoDoPacote(c.custoSku, fatorDoPacote(c.fator, 1)),
    classico: tipo,
    premium: tipo,
  });
  if (m.classico.estado !== 'ok') throw new Error(m.classico.motivo);
  return m.classico.valor;
}

/** Viabilidade: comissão = sale_fee_amount ?? 0 (analisar-item-viabilidade), imposto round2 (viabilidade-linha). */
function viabilidade(c: Caso) {
  const custo = c.custoSku * c.fator;
  const imposto = round2(c.preco * c.aliquotaPct / 100);
  const recebe = liquidoNoMercado(c.preco, c.lp.sale_fee_amount ?? 0, imposto, c.frete)!;
  return { recebe, lucro: calcularMarkup(recebe, custo).lucro };
}

/** Pulse: comissão pela estrutura (percentual + fixa) no preço praticado, sem arredondar componentes. */
function pulse(c: Caso) {
  const custo = c.custoSku * c.fator;
  const { percentual, fixa } = comissaoDe(c.lp as ListingPriceML);
  const r = margemEstimada({ preco: c.preco, custoProduto: custo, comissao: { pct: percentual, fixa }, frete: c.frete, aliquotaPct: c.aliquotaPct })!;
  return { recebe: r.liquido + custo, lucro: r.liquido };
}

describe('paridade financeira: Minha margem × Viabilidade × Pulse (≤ R$ 0,05)', () => {
  it.each(CASOS.map((c) => [c.nome, c] as const))('%s', (_, c) => {
    const e = extensao(c);
    const p = pulse(c);
    expect(Math.abs(e.recebe - p.recebe)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(e.lucro! - p.lucro)).toBeLessThanOrEqual(TOL);
    expect(e.custo).toBe(round2(c.custoSku * c.fator));

    const v = viabilidade(c);
    if (!c.viabilidadeDiverge) {
      expect(Math.abs(e.recebe - v.recebe)).toBeLessThanOrEqual(TOL);
      expect(Math.abs(e.lucro! - v.lucro)).toBeLessThanOrEqual(TOL);
    }
  });

  // Divergências conhecidas da Viabilidade, fora do escopo da extensão (não corrigidas aqui):
  it('sem sale_fee_amount: Viabilidade desconta comissão 0 (fallback `?? 0`); extensão e Pulse descontam 10,79', () => {
    const c = CASOS.find((x) => x.nome.includes('sem sale_fee_amount'))!;
    expect(extensao(c)).toMatchObject({ comissao: 10.79, imposto: 7.19, recebe: 53.02, lucro: 23.02 });
    expect(viabilidade(c)).toEqual({ recebe: 63.81, lucro: expect.closeTo(33.81, 2) });
  });

  it('preço ≠ consultado: Viabilidade sempre usa o sale_fee_amount do preço consultado; extensão recalcula no preço', () => {
    const c = CASOS.find((x) => x.precoConsultado != null)!;
    // Extensão: 99,90 × 12% = 11,99; a Viabilidade só calcula no próprio menor preço (consultado), então
    // a comparação direta não se aplica — registrado para não ser lido como paridade.
    expect(extensao(c)).toMatchObject({ comissao: 11.99, recebe: 61.02 });
  });
});
