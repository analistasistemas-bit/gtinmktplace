import { describe, expect, it } from 'vitest';
import {
  calcularCoberturaEstimativa,
  calcularConcentracaoPorVendedor,
  calcularVendedoresSemEstimativa,
  calcularVolumeNicho,
  UNIDADE_VENDEDOR,
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

describe('calcularVolumeNicho — contrato 3.2', () => {
  it('usa mediana, nunca soma nem média — critério aceite 6', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const serie = [
      ...snap('a', 100, 110),
      ...snap('b', 100, 115),
      ...snap('c', 100, 120),
      ...snap('d', 100, 125),
      ...snap('e', 100, 10_100),
    ];
    const r = calcularVolumeNicho(ids, serie);
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.vendas_mes_mediana).toBeCloseTo(20, 0);
    // média seria 2014 (dominada pelo outlier) e soma 10.070
    expect(r.vendas_mes_mediana).not.toBeCloseTo(2014, 0);
  });

  it('rotula a unidade da ADR-0143: catálogos da amostra, não a amostra', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const r = calcularVolumeNicho(ids, ids.flatMap((v) => serieTipica(v)));
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.rotulo).toContain(UNIDADE_VENDEDOR);
    expect(r.rotulo).toContain('catálogos desta amostra');
  });

  it('mediana zero é valor medido, nunca ausência (D-3/D-4 da 0142)', () => {
    // Caso real do aptamil: 53% dos vendedores do catálogo têm delta zero.
    const parados = ['p1', 'p2', 'p3'].flatMap((v) => snap(v, 500, 500));
    const ativos = ['a1', 'a2'].flatMap((v) => serieTipica(v));
    const r = calcularVolumeNicho(['p1', 'p2', 'p3', 'a1', 'a2'], [...parados, ...ativos]);
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.vendas_mes_mediana).toBe(0);
    expect(r.vendedores_com_estimativa).toBe(5);
  });

  it('sem vendedores com estimativa devolve sem_dado', () => {
    const r = calcularVolumeNicho(['solo'], [{ seller_id: 'solo', transactions_total: 50, dia: '2026-08-15' }]);
    expect(r.estado).toBe('sem_dado');
  });

  it('mediana de menos de 5 vendedores não vai para tela (spike 045)', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const r = calcularVolumeNicho(ids, ids.flatMap((v) => serieTipica(v)));
    expect(r.estado).toBe('sem_dado');
    if (r.estado !== 'sem_dado') return;
    expect(r.mensagem).toContain('5');
  });

  it('vendedor único gigante não vira nicho (regressão spike 045)', () => {
    const r = calcularVolumeNicho(
      ['480265022'],
      snap('480265022', 31_347_465, 31_746_992, '2026-08-20', '2026-08-29'),
    );
    expect(r.estado).toBe('sem_dado');
  });
});

describe('calcularCoberturaEstimativa — contrato 3.3', () => {
  it('reporta vendedores com estimativa / distintos — critério aceite 7', () => {
    const ids = ['1', '2', '3', '4'];
    const serie = [...serieTipica('1'), ...serieTipica('2')];
    const c = calcularCoberturaEstimativa(ids, serie, 20, 8);
    expect(c.com_estimativa).toBe(2);
    expect(c.vendedores_distintos).toBe(4);
    expect(c.proporcao).toBe(0.5);
    expect(c.rotulo).toContain('2 de 4 vendedores com estimativa mensal');
  });

  it('o denominador de anúncios é a amostra inteira, não os que têm catálogo (spike 045)', () => {
    const c = calcularCoberturaEstimativa(['480265022'], serieTipica('480265022'), 104, 26);
    expect(c.anuncios_na_amostra).toBe(104);
    expect(c.anuncios_com_catalogo).toBe(26);
    expect(c.proporcao_anuncios).toBeCloseTo(26 / 104, 6);
    // o defeito antigo: a proporção de vendedores sozinha dizia 100%
    expect(c.proporcao).toBe(1);
    expect(c.rotulo).toContain('26 de 104 anúncios da amostra têm catálogo');
  });

  it('amostra vazia não divide por zero', () => {
    const c = calcularCoberturaEstimativa([], [], 0, 0);
    expect(c.proporcao).toBeNull();
    expect(c.proporcao_anuncios).toBeNull();
  });
});

describe('calcularVendedoresSemEstimativa — contrato 3.4', () => {
  it('conta serie_insuficiente, sem_estimativa_no_periodo e sem série alguma', () => {
    const serie = [
      ...serieTipica('ok'),
      { seller_id: 'insuf', transactions_total: 100, dia: '2026-08-01' },
      ...snap('neg', 20_000, 15_125, '2026-08-16', '2026-08-29'),
    ];
    const r = calcularVendedoresSemEstimativa(['ok', 'insuf', 'neg', 'nunca-visto'], serie);
    expect(r.contagem).toBe(3);
    expect(r.rotulo).not.toMatch(/venderam/i);
    expect(r.rotulo).toContain('sem estimativa mensal');
  });
});

describe('calcularConcentracaoPorVendedor — contrato 7.4', () => {
  it('agrupa por seller_id — critério aceite 10', () => {
    const anuncios = Array.from({ length: 6 }, (_, i) =>
      anuncio({ seller_id: i < 3 ? 'L1' : 'L2', item_id: `MLB${i}`, vendidos: 100, preco: 10 }),
    );
    expect(calcularConcentracaoPorVendedor(anuncios)).toBeNull();
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
