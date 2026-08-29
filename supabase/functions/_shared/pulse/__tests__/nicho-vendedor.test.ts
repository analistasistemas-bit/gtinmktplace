import { describe, expect, it } from 'vitest';
import {
  calcularCoberturaEstimativa,
  calcularConcentracaoPorVendedor,
  calcularFaturamentoNichoTopN,
  calcularVendedoresSemEstimativa,
  calcularVolumeNicho,
  precoRepresentativo,
  type AnuncioAmostra,
} from '../nicho-vendedor.ts';

const snap = (
  seller_id: string | number,
  t0: number,
  t1: number,
  dia0 = '2026-08-01',
  dia1 = '2026-08-31',
) => [
  { seller_id, transactions_total: t0, dia: dia0 },
  { seller_id, transactions_total: t1, dia: dia1 },
];

/** Delta 21 em 30 dias → vendas_mes ≈ 21 */
const serieTipica = (seller_id: string, delta = 21) => snap(seller_id, 100, 100 + delta);

function anuncio(
  partial: Partial<AnuncioAmostra> & Pick<AnuncioAmostra, 'seller_id'>,
): AnuncioAmostra {
  return {
    item_id: partial.item_id ?? `MLB-${partial.seller_id}`,
    seller_id: partial.seller_id,
    preco: partial.preco ?? null,
    vendidos: partial.vendidos ?? null,
  };
}

describe('precoRepresentativo', () => {
  it('escolhe preço do anúncio com maior vendidos×preço', () => {
    const preco = precoRepresentativo([
      anuncio({ seller_id: 'A', item_id: '1', vendidos: 100, preco: 10 }),
      anuncio({ seller_id: 'A', item_id: '2', vendidos: 50, preco: 100 }),
    ]);
    expect(preco).toBe(100);
  });

  it('sem vendidos usa maior preço', () => {
    const preco = precoRepresentativo([
      anuncio({ seller_id: 'A', vendidos: null, preco: 30 }),
      anuncio({ seller_id: 'A', vendidos: null, preco: 45 }),
    ]);
    expect(preco).toBe(45);
  });
});

describe('calcularFaturamentoNichoTopN — contrato 2.6/3.1', () => {
  it('soma vendas_mes × preço representativo por vendedor com estimativa', () => {
    const anuncios = [
      anuncio({ seller_id: 'v1', vendidos: 1000, preco: 10 }),
      anuncio({ seller_id: 'v2', vendidos: 500, preco: 20 }),
    ];
    const serie = [...serieTipica('v1'), ...serieTipica('v2')];
    const r = calcularFaturamentoNichoTopN(anuncios, serie);
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    // v1: 21×10=210, v2: 21×20=420 → 630
    expect(r.faturamento_mes).toBeCloseTo(630, 0);
    expect(r.vendedores_com_estimativa).toBe(2);
    expect(r.rotulo).toContain('2 vendedores');
  });

  it('rotula N real de vendedores — critério aceite 3', () => {
    const anuncios = [
      anuncio({ seller_id: 'a', preco: 10, vendidos: 1 }),
      anuncio({ seller_id: 'b', preco: 10, vendidos: 1 }),
      anuncio({ seller_id: 'c', preco: 10, vendidos: 1 }),
      anuncio({ seller_id: 'd', preco: 10, vendidos: 1 }),
      anuncio({ seller_id: 'e', preco: 10, vendidos: 1 }),
    ];
    const serie = [
      ...serieTipica('a'),
      ...serieTipica('b'),
      ...serieTipica('c'),
      { seller_id: 'd', transactions_total: 100, dia: '2026-08-01' },
      ...snap('e', 1000, 500),
    ];
    const r = calcularFaturamentoNichoTopN(anuncios, serie);
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.vendedores_com_estimativa).toBe(3);
    expect(r.vendedores_distintos).toBe(5);
    expect(r.rotulo).toContain('3 vendedores');
  });

  it('sem estimativa válida devolve sem_dado', () => {
    const r = calcularFaturamentoNichoTopN(
      [anuncio({ seller_id: 'x', preco: 10, vendidos: 1 })],
      [{ seller_id: 'x', transactions_total: 100, dia: '2026-08-01' }],
    );
    expect(r).toEqual({
      estado: 'sem_dado',
      mensagem: 'nenhum vendedor da amostra tem estimativa mensal',
    });
  });
});

describe('calcularVolumeNicho — contrato 3.2', () => {
  it('usa mediana, nunca soma nem média — critério aceite 6', () => {
    const anuncios = [
      anuncio({ seller_id: 'a' }),
      anuncio({ seller_id: 'b' }),
      anuncio({ seller_id: 'c' }),
    ];
    const serie = [
      ...snap('a', 100, 110),
      ...snap('b', 100, 120),
      ...snap('c', 100, 10_100),
    ];
    const r = calcularVolumeNicho(anuncios, serie);
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.vendas_mes_mediana).toBeCloseTo(20, 0);
    expect(r.vendas_mes_mediana).not.toBeCloseTo(3433, 0);
  });

  it('sem vendedores com estimativa devolve sem_dado', () => {
    const r = calcularVolumeNicho(
      [anuncio({ seller_id: 'solo' })],
      [{ seller_id: 'solo', transactions_total: 50, dia: '2026-08-15' }],
    );
    expect(r.estado).toBe('sem_dado');
  });
});

describe('calcularCoberturaEstimativa — contrato 3.3', () => {
  it('reporta vendedores com estimativa / distintos — critério aceite 7', () => {
    const anuncios = [
      anuncio({ seller_id: '1' }),
      anuncio({ seller_id: '2' }),
      anuncio({ seller_id: '3' }),
      anuncio({ seller_id: '4' }),
    ];
    const serie = [...serieTipica('1'), ...serieTipica('2')];
    const c = calcularCoberturaEstimativa(anuncios, serie);
    expect(c.com_estimativa).toBe(2);
    expect(c.vendedores_distintos).toBe(4);
    expect(c.proporcao).toBe(0.5);
    expect(c.rotulo).toBe('2 de 4 vendedores com estimativa mensal');
  });
});

describe('calcularVendedoresSemEstimativa — contrato 3.4', () => {
  it('conta serie_insuficiente e sem_estimativa_no_periodo', () => {
    const anuncios = [
      anuncio({ seller_id: 'ok' }),
      anuncio({ seller_id: 'insuf' }),
      anuncio({ seller_id: 'neg' }),
    ];
    const serie = [
      ...serieTipica('ok'),
      { seller_id: 'insuf', transactions_total: 100, dia: '2026-08-01' },
      ...snap('neg', 20_000, 15_125, '2026-08-16', '2026-08-29'),
    ];
    const r = calcularVendedoresSemEstimativa(anuncios, serie);
    expect(r.contagem).toBe(2);
    expect(r.rotulo).not.toMatch(/venderam/i);
    expect(r.rotulo).toContain('sem estimativa mensal');
  });
});

describe('calcularConcentracaoPorVendedor — contrato 7.4', () => {
  it('agrupa por seller_id — critério aceite 10', () => {
    const anuncios = Array.from({ length: 6 }, (_, i) =>
      anuncio({
        seller_id: i < 3 ? 'L1' : 'L2',
        item_id: `MLB${i}`,
        vendidos: 100,
        preco: 10,
      }),
    );
    const c = calcularConcentracaoPorVendedor(anuncios);
    expect(c).toBeNull();
  });

  it('calcula share ADR-0137 sobre faturamento por vendedor', () => {
    const lider = Array.from({ length: 3 }, (_, i) =>
      anuncio({ seller_id: 'LIDER', item_id: `L${i}`, vendidos: 1000, preco: 1 }),
    );
    const outros = Array.from({ length: 4 }, (_, i) =>
      anuncio({ seller_id: `O${i}`, item_id: `O${i}`, vendidos: 100, preco: 1 }),
    );
    const c = calcularConcentracaoPorVendedor([...lider, ...outros]);
    expect(c).not.toBeNull();
    if (!c) return;
    expect(c.elegiveis).toBe(5);
    expect(c.top1).toBeCloseTo(3000 / 3400, 4);
    expect(c.corte).toBe(0.4);
    expect(c.dominante).toBe(true);
  });

  it('retorna null com menos de 5 vendedores elegíveis', () => {
    const anuncios = Array.from({ length: 4 }, (_, i) =>
      anuncio({ seller_id: `V${i}`, vendidos: 100, preco: 10 }),
    );
    expect(calcularConcentracaoPorVendedor(anuncios)).toBeNull();
  });
});
