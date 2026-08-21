import { describe, it, expect } from 'vitest';
import {
  estadoAtualOfertas, menorPrecoPorDia, vendasEstimadasVendedor, margemEstimada, comissaoNoPreco,
  margemEhEstimativa, mercadoPulse,
} from '../pulse-margem';
import type { PulseOferta, PulseVendedor } from '../pulse';

const oferta = (over: Partial<PulseOferta>): PulseOferta => ({
  item_id: 'MLB1', seller_id: 111, preco: 100, tier: 'gold_special',
  frete_gratis: true, loja_oficial: false, ativo: true, dia: '2026-08-10', permalink: null,
  visitas_30d: null, visitas_30d_em: null, ...over,
});

const vendedor = (over: Partial<PulseVendedor>): PulseVendedor => ({
  seller_id: 111, nickname: 'LOJA', power_seller: 'platinum', nivel: '5_green',
  transactions_total: 100, dia: '2026-08-10', uf: null,
  reputacao_detalhe: null, perfil_coletado_em: null, ...over,
});

describe('mercadoPulse', () => {
  it('usa R$70,19 como menor relevante e preserva R$36 observado', () => {
    const mercado = mercadoPulse([
      oferta({ item_id: 'MLB36', seller_id: 1, preco: 36, visitas_30d: 19 }),
      oferta({ item_id: 'MLB70', seller_id: 2, preco: 70.19, visitas_30d: 1 }),
    ], [
      vendedor({ seller_id: 1, transactions_total: 0 }),
      vendedor({ seller_id: 2, transactions_total: 10, nivel: '3_yellow' }),
    ]);

    expect(mercado.menor_observado).toBe(36);
    expect(mercado.menor_relevante).toBe(70.19);
  });

  it('usa o snapshot mais recente do vendedor na junção', () => {
    const mercado = mercadoPulse([
      oferta({ seller_id: 2, preco: 70.19 }),
    ], [
      vendedor({ seller_id: 2, transactions_total: 10, dia: '2026-08-10' }),
      vendedor({ seller_id: 2, transactions_total: 0, dia: '2026-08-11' }),
    ]);

    expect(mercado.menor_relevante).toBeNull();
  });

  it('não reprova oferta relevante quando visitas ainda não foram medidas', () => {
    const mercado = mercadoPulse([
      oferta({ seller_id: 2, preco: 70.19, visitas_30d: null }),
    ], [
      vendedor({ seller_id: 2, transactions_total: 10, nivel: '3_yellow' }),
    ]);

    expect(mercado.menor_relevante).toBe(70.19);
  });
});

describe('estadoAtualOfertas', () => {
  it('mantém só a última linha por item (por dia), ordenada por preço', () => {
    const ofertas = [
      oferta({ item_id: 'A', dia: '2026-08-10', preco: 100 }),
      oferta({ item_id: 'A', dia: '2026-08-12', preco: 90 }), // mais recente vence
      oferta({ item_id: 'B', dia: '2026-08-11', preco: 50 }),
    ];
    expect(estadoAtualOfertas(ofertas)).toEqual([
      oferta({ item_id: 'B', dia: '2026-08-11', preco: 50 }),
      oferta({ item_id: 'A', dia: '2026-08-12', preco: 90 }),
    ]);
  });

  it('descarta item cuja última linha está desativada (oferta saiu do catálogo)', () => {
    const ofertas = [
      oferta({ item_id: 'A', dia: '2026-08-10', preco: 100, ativo: true }),
      oferta({ item_id: 'A', dia: '2026-08-12', preco: 100, ativo: false }),
      oferta({ item_id: 'B', dia: '2026-08-10', preco: 80, ativo: true }),
    ];
    expect(estadoAtualOfertas(ofertas)).toEqual([oferta({ item_id: 'B', dia: '2026-08-10', preco: 80 })]);
  });
});

describe('menorPrecoPorDia', () => {
  it('agrupa o menor preço entre as ofertas ativas de cada dia, em ordem cronológica', () => {
    const ofertas = [
      oferta({ dia: '2026-08-12', preco: 90, item_id: 'A' }),
      oferta({ dia: '2026-08-10', preco: 100, item_id: 'A' }),
      oferta({ dia: '2026-08-10', preco: 80, item_id: 'B' }),
      oferta({ dia: '2026-08-11', preco: 70, item_id: 'C', ativo: false }), // desativada: ignora
    ];
    expect(menorPrecoPorDia(ofertas)).toEqual([
      { dia: '2026-08-10', preco: 80 },
      { dia: '2026-08-12', preco: 90 },
    ]);
  });
});

describe('vendasEstimadasVendedor', () => {
  it('retorna null com menos de 2 pontos', () => {
    expect(vendasEstimadasVendedor([])).toBeNull();
    expect(vendasEstimadasVendedor([vendedor({})])).toBeNull();
  });

  it('calcula o delta entre a 1ª e a última leitura (ordena por dia)', () => {
    const hist = [
      vendedor({ dia: '2026-08-14', transactions_total: 130 }),
      vendedor({ dia: '2026-08-10', transactions_total: 100 }),
    ];
    expect(vendasEstimadasVendedor(hist)).toBe(30);
  });

  it('retorna null se algum ponto não tiver transactions_total', () => {
    const hist = [
      vendedor({ dia: '2026-08-10', transactions_total: null }),
      vendedor({ dia: '2026-08-14', transactions_total: 130 }),
    ];
    expect(vendasEstimadasVendedor(hist)).toBeNull();
  });
});

describe('comissaoNoPreco', () => {
  it('percentual mais parcela fixa', () => {
    expect(comissaoNoPreco(39.9, { pct: 14, fixa: 0 })).toBeCloseTo(5.586, 3);
    expect(comissaoNoPreco(10, { pct: 14, fixa: 4.99 })).toBeCloseTo(6.39, 2);
  });

  it('sem percentual não há comissão para calcular — comissão não se estima', () => {
    expect(comissaoNoPreco(100, { pct: null, fixa: 0 })).toBeNull();
    expect(comissaoNoPreco(100, null)).toBeNull();
  });

  it('parcela fixa ausente conta como zero, não invalida o cálculo', () => {
    expect(comissaoNoPreco(100, { pct: 14, fixa: null })).toBe(14);
  });
});

describe('margemEstimada — regra LOUD: qualquer insumo ausente → null', () => {
  const base = {
    preco: 100, custoProduto: 40, comissao: { pct: 10, fixa: 0 }, frete: 8, aliquotaPct: 8,
  };

  it('calcula margem completa quando todos os insumos existem', () => {
    // líquido = 100 − 10 − 8 − (100*8/100) − 40 = 34
    expect(margemEstimada(base)).toEqual({ liquido: 34, margemPct: 34, comissao: 10 });
  });

  // Caso real que originou a Errata 6: o app usava a comissão do preço SUGERIDO (R$ 4,62 sobre
  // R$ 32,99) no preço praticado de R$ 39,90, e exibia R$ 5,36 de sobra em vez de R$ 4,39.
  it('reproduz o caso NIVEA a R$ 39,90 com a comissão do preço certo', () => {
    const m = margemEstimada({
      preco: 39.9, custoProduto: 20.08, comissao: { pct: 14, fixa: 0 }, frete: 6.65, aliquotaPct: 8,
    })!;
    expect(m.comissao).toBeCloseTo(5.59, 2);
    expect(m.liquido).toBeCloseTo(4.39, 2);
    expect(m.margemPct).toBeCloseTo(11.0, 1);
    // A conta antiga daria 5,36 — a diferença é o que estava sendo mostrado a mais.
    expect(m.liquido).toBeLessThan(5.36);
  });

  it('retorna null sem custo do produto', () => {
    expect(margemEstimada({ ...base, custoProduto: null })).toBeNull();
  });

  it('retorna null sem a estrutura da comissão', () => {
    expect(margemEstimada({ ...base, comissao: { pct: null, fixa: 0 } })).toBeNull();
    expect(margemEstimada({ ...base, comissao: null })).toBeNull();
  });

  it('retorna null sem frete', () => {
    expect(margemEstimada({ ...base, frete: null })).toBeNull();
  });

  it('retorna null sem alíquota de imposto', () => {
    expect(margemEstimada({ ...base, aliquotaPct: null })).toBeNull();
  });
});

// Errata 7 do ADR-0119: o rótulo "estimativa" ancora no preço em que a comissão foi LIDA, não no
// preço atual do anúncio. Antes ancorava em `meu_preco`, e o caso com promoção — leitura feita no
// preço base, exibição no efetivo — saía sem rótulo, com a confiança de um valor exato.
describe('margemEhEstimativa', () => {
  it('preço simulado igual ao da leitura da comissão → número exato, sem rótulo', () => {
    expect(margemEhEstimativa(39.9, 39.9)).toBe(false);
  });

  it('tolera ruído de centavo (arredondamento não vira estimativa)', () => {
    expect(margemEhEstimativa(39.902, 39.9)).toBe(false);
  });

  it('preço simulado fora do preço da leitura → estimativa', () => {
    expect(margemEhEstimativa(32.99, 39.9)).toBe(true);
  });

  // O caso que a Errata 7 corrigiu: anúncio promovido, comissão lida no preço BASE (38,90) e tela
  // exibindo o efetivo (35,79). Ancorado em `meu_preco` isso dava "exato"; ancorado na leitura,
  // sai rotulado.
  it('promoção: exibir o efetivo com comissão lida no base é estimativa', () => {
    expect(margemEhEstimativa(35.79, 38.9)).toBe(true);
  });

  it('preço da leitura desconhecido (linha anterior à Errata 7) → estimativa', () => {
    expect(margemEhEstimativa(39.9, null)).toBe(true);
  });

  it('sem preço simulado → estimativa (nunca afirma exatidão sobre nada)', () => {
    expect(margemEhEstimativa(null, 39.9)).toBe(true);
  });
});
