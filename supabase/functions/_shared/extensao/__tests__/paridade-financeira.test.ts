// Paridade financeira (ADR-0189 Task 11A): a "Minha margem" da extensão bate com a Viabilidade e com o Pulse
// dentro de R$ 0,05, partindo do MESMO listing_prices do ML. Só funções reais exportadas — nada reimplementado:
// - Viabilidade: `analisarItemViabilidade` (_shared/analise) monta a comissão a partir do listing_prices;
//   a tela desconta com `impostoNoPreco` + `liquidoNoMercado` (src/lib/viabilidade) e `calcularMarkup` (src/lib/markup).
// - Pulse: `margemEstimada` (src/lib/pulse-margem), com a estrutura percentual + fixa do listing_prices.
import { describe, expect, it } from 'vitest';
import { calcularMinhaMargem, custoDoPacote, fatorDoPacote } from '../margem.ts';
import type { ComissaoML, Disponivel, MargemTipo } from '../tipos.ts';
import { comissaoDaListingPrice } from '../../../extensao/roteamento.ts';
import { comissaoDe } from '../../ml/listing-prices.ts';
import type { ListingPriceML } from '../../ml/tarifa.ts';
import { analisarItemViabilidade } from '../../analise/analisar-item-viabilidade.ts';
import { impostoNoPreco, liquidoNoMercado } from '../../../../../src/lib/viabilidade';
import { calcularMarkup } from '../../../../../src/lib/markup';
import { margemEstimada } from '../../../../../src/lib/pulse-margem';

const TOL = 0.05;

interface Caso {
  nome: string;
  preco: number;
  /** resposta do /sites/MLB/listing_prices no preço (sale_fee_amount pode faltar). */
  lp: Partial<ListingPriceML>;
  frete: number;
  aliquotaPct: number;
  custoSku: number;
  /** SKUs por anúncio (kit). */
  fator: number;
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
  { nome: 'Clássico, frete > 0, nacional 8%', preco: 89.9, lp: lp(12, 0, 10.79), frete: 18.9, aliquotaPct: 8, custoSku: 30, fator: 1 },
];
const SEM_SALE_FEE: Caso = { nome: 'Clássico sem sale_fee_amount', preco: 89.9, lp: lp(12, 0), frete: 18.9, aliquotaPct: 8, custoSku: 30, fator: 1 };

function extensao(
  c: Caso,
  comissao: Disponivel<ComissaoML> = comissaoDaListingPrice(c.lp as ListingPriceML, c.preco),
  frete: Disponivel<number> = { estado: 'ok', valor: c.frete },
): Disponivel<MargemTipo> {
  const tipo = { comissao, frete };
  return calcularMinhaMargem({
    preco: c.preco,
    aliquotaPct: { estado: 'ok', valor: c.aliquotaPct },
    custoPacote: custoDoPacote(c.custoSku, fatorDoPacote(c.fator, 1)),
    classico: tipo,
    premium: tipo,
  }).classico;
}
const okDe = (d: Disponivel<MargemTipo>) => { if (d.estado !== 'ok') throw new Error(d.motivo); return d.valor; };

/** Viabilidade real: orquestrador da edge (menor preço = preço do caso) + o desconto que a tela faz. */
async function viabilidade(c: Caso) {
  const item = await analisarItemViabilidade({
    item: { gtin: '7899941205918', nome: 'x', unidade: null, minimo: null, custo: c.custoSku * c.fator, origem: 'nacional' },
    contaExternaId: '111',
    deps: {
      buscarConcorrencia: async () => ({ product_id: 'MLB1', ofertas: { category_id: 'MLB5', ofertas_detalhe: [] } }) as never,
      buscarVariacaoSalva: async () => ({ jaCadastrado: false, dimensoes: null }) as never,
      obterToken: async () => 'tok',
      resolverMercado: async () => ({ menor: c.preco, maior: c.preco, vendedores: 1, freteGratis: 0, full: 0, ofertas: 1 }) as never,
      buscarListingPrice: async () => c.lp as ListingPriceML,
      buscarFreteVendedor: async () => c.frete,
    },
  });
  const recebe = liquidoNoMercado(c.preco, item.classico!.saleFeeAmount, impostoNoPreco(c.preco, c.aliquotaPct), item.frete!)!;
  return { recebe, lucro: calcularMarkup(recebe, c.custoSku * c.fator).lucro };
}

/** Pulse real: estrutura percentual + fixa no preço praticado. */
function pulse(c: Caso) {
  const custo = c.custoSku * c.fator;
  const { percentual, fixa } = comissaoDe(c.lp as ListingPriceML);
  const r = margemEstimada({ preco: c.preco, custoProduto: custo, comissao: { pct: percentual, fixa }, frete: c.frete, aliquotaPct: c.aliquotaPct })!;
  return { recebe: r.liquido + custo, lucro: r.liquido };
}

describe('paridade financeira: Minha margem × Viabilidade × Pulse (≤ R$ 0,05)', () => {
  it.each(CASOS.map((c) => [c.nome, c] as const))('%s', async (_, c) => {
    const e = okDe(extensao(c));
    const v = await viabilidade(c);
    const p = pulse(c);
    expect(e.custo).toBe(Math.round(c.custoSku * c.fator * 100) / 100);
    expect(Math.abs(e.recebe - v.recebe)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(e.lucro! - v.lucro)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(e.recebe - p.recebe)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(e.lucro! - p.lucro)).toBeLessThanOrEqual(TOL);
  });

  describe('sem sale_fee_amount', () => {
    it('extensão e Pulse descontam a comissão pela estrutura (12% de 89,90 = 10,79)', () => {
      const e = okDe(extensao(SEM_SALE_FEE));
      expect(e).toMatchObject({ comissao: 10.79, imposto: 7.19, frete: 18.9, recebe: 53.02, lucro: 23.02 });
      expect(Math.abs(e.recebe - pulse(SEM_SALE_FEE).recebe)).toBeLessThanOrEqual(TOL);
    });

    // BUG CONHECIDO DA VIABILIDADE (fora do escopo da extensão; correção é item separado — Ruling de paridade
    // no progress.md da extensão, revisão Codex 2026-10-22 #15): `analisarItemViabilidade` lê `sale_fee_amount ?? 0` e desconta comissão ZERO quando o
    // ML não manda o valor pronto. Falha esperada até a correção da Viabilidade — quando ela for corrigida, este
    // teste passa a "passar" e o `it.fails` precisa virar `it`.
    it.fails('Viabilidade bate com a extensão (falha esperada: comissão 0 por `sale_fee_amount ?? 0`)', async () => {
      const v = await viabilidade(SEM_SALE_FEE);
      expect(Math.abs(okDe(extensao(SEM_SALE_FEE)).recebe - v.recebe)).toBeLessThanOrEqual(TOL);
    });
  });

  describe('insumo do ML indisponível → extensão "indisponível", nunca número', () => {
    const c = CASOS[5];
    it('comissão sem sale_fee_details → indisponível (Pulse também não calcula)', () => {
      const semDetalhe = comissaoDaListingPrice({ sale_fee_amount: 10.79 } as ListingPriceML, c.preco);
      expect(semDetalhe.estado).toBe('indisponivel');
      expect(extensao(c, semDetalhe).estado).toBe('indisponivel');
      expect(margemEstimada({ preco: c.preco, custoProduto: 30, comissao: null, frete: c.frete, aliquotaPct: 8 })).toBeNull();
    });
    it('frete indisponível → indisponível (Pulse também não calcula)', () => {
      const r = extensao(c, undefined, { estado: 'indisponivel', motivo: 'o Mercado Livre recusou o cálculo de frete (HTTP 500)' });
      expect(r).toEqual({ estado: 'indisponivel', motivo: 'o Mercado Livre recusou o cálculo de frete (HTTP 500)' });
      expect(margemEstimada({ preco: c.preco, custoProduto: 30, comissao: { pct: 12, fixa: 0 }, frete: null, aliquotaPct: 8 })).toBeNull();
    });
    it('comissão e frete indisponíveis → indisponível', () => {
      const r = extensao(c, { estado: 'indisponivel', motivo: 'falha ao consultar o Mercado Livre' }, { estado: 'indisponivel', motivo: 'x' });
      expect(r.estado).toBe('indisponivel');
      expect(JSON.stringify(r)).not.toMatch(/"valor"/);
    });
  });
});
