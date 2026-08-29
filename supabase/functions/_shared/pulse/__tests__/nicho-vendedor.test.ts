import { describe, expect, it } from 'vitest';
import {
  calcularAtividadeNicho,
  calcularCoberturaEstimativa,
  calcularConcentracaoPorVendedor,
  calcularVendedoresSemEstimativa,
  calcularVolumeNicho,
  UNIDADE_VENDEDOR,
  vendedoresEstabelecidos,
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

  it('rotula com dias observados e "estabelecidos", nunca "365" — critério aceite 7/8', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const r = calcularVolumeNicho(ids, ids.flatMap((v) => serieTipica(v)));
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.rotulo).toContain('em 30 dias');
    expect(r.rotulo).toContain('5 vendedores estabelecidos');
    expect(r.rotulo).not.toContain('365');
  });

  it('UNIDADE_VENDEDOR não cita "365" e mantém "catálogos desta amostra"', () => {
    expect(UNIDADE_VENDEDOR).toContain('catálogos desta amostra');
    expect(UNIDADE_VENDEDOR).not.toContain('365');
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

  it('sub-50 não entra na mediana nem no denominador do piso — critério aceite 1 (caso aptamil)', () => {
    // 5 estabelecidos com o mesmo movimento (delta 21) + 3 "fantasmas" que nunca chegam a 50 no
    // primeiro snapshot, mesmo com delta grande. Sem o filtro, a mediana de 8 despencaria.
    const estabelecidos = ['a', 'b', 'c', 'd', 'e'].flatMap((v) => serieTipica(v));
    const fantasmas = ['f1', 'f2', 'f3'].flatMap((v) => snap(v, 10, 910));
    const r = calcularVolumeNicho(
      ['a', 'b', 'c', 'd', 'e', 'f1', 'f2', 'f3'],
      [...estabelecidos, ...fantasmas],
    );
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.vendas_mes_mediana).toBeCloseTo(21, 0);
    expect(r.vendedores_com_estimativa).toBe(5);
  });

  it('vendedor único gigante não vira nicho (regressão spike 045)', () => {
    const r = calcularVolumeNicho(
      ['480265022'],
      snap('480265022', 31_347_465, 31_746_992, '2026-08-20', '2026-08-29'),
    );
    expect(r.estado).toBe('sem_dado');
  });
});

describe('vendedoresEstabelecidos — ADR-0145 D-1', () => {
  it('total < 50 no primeiro snapshot fica fora — critério aceite 1', () => {
    const serie = snap('pequeno', 40, 45);
    expect(vendedoresEstabelecidos(['pequeno'], serie).size).toBe(0);
  });

  it('total >= 50 no primeiro snapshot entra', () => {
    const serie = snap('grande', 50, 60);
    expect(vendedoresEstabelecidos(['grande'], serie)).toEqual(new Set(['grande']));
  });

  it('filtro usa o PRIMEIRO snapshot: t0=40, t1=80 continua fora — critério aceite 2', () => {
    const serie = snap('cresceu', 40, 80);
    expect(vendedoresEstabelecidos(['cresceu'], serie).size).toBe(0);
  });

  it('vendedor sem série não é estabelecido', () => {
    expect(vendedoresEstabelecidos(['fantasma'], []).size).toBe(0);
  });
});

describe('calcularAtividadeNicho — contrato 3.6', () => {
  it('conta ativos entre estabelecidos e devolve dias_janela — critério aceite 8', () => {
    const ids = ['a', 'b', 'c'];
    const serie = [
      ...serieTipica('a'), // ativo
      ...serieTipica('b'), // ativo
      ...snap('c', 100, 100), // estabelecido, parado
    ];
    const a = calcularAtividadeNicho(ids, serie);
    expect(a.estabelecidos).toBe(3);
    expect(a.ativos).toBe(2);
    expect(a.dias_janela).toBe(30);
    expect(a.rotulo).toContain('2 de 3 vendedores estabelecidos venderam em 30 dias');
    expect(a.rotulo).not.toContain('365');
  });

  it('com 1 a 4 estabelecidos ainda aparece, com base_pequena — critério aceite 5', () => {
    const ids = ['a', 'b', 'c'];
    const serie = ids.flatMap((v) => serieTipica(v));
    const a = calcularAtividadeNicho(ids, serie);
    expect(a.estabelecidos).toBe(3);
    expect(a.base_pequena).toBe(true);

    const volume = calcularVolumeNicho(ids, serie);
    expect(volume.estado).toBe('sem_dado');
  });

  it('sem estabelecido nenhum devolve rótulo de ausência, sem base_pequena', () => {
    const a = calcularAtividadeNicho(['x'], snap('x', 10, 20));
    expect(a.estabelecidos).toBe(0);
    expect(a.base_pequena).toBe(false);
    expect(a.rotulo).toBe('nenhum vendedor estabelecido nos catálogos desta amostra');
  });

  it('vendedor abaixo de 50 não entra na atividade, mesmo vendendo muito em termos relativos', () => {
    const a = calcularAtividadeNicho(['pequeno'], snap('pequeno', 10, 40));
    expect(a.estabelecidos).toBe(0);
    expect(a.ativos).toBe(0);
  });
});

describe('calcularCoberturaEstimativa — contrato 3.3', () => {
  it('reporta vendedores com estimativa / distintos / estabelecidos — critério aceite 7', () => {
    const ids = ['1', '2', '3', '4'];
    const serie = [...serieTipica('1'), ...serieTipica('2')];
    const c = calcularCoberturaEstimativa(ids, serie, 20, 8);
    expect(c.com_estimativa).toBe(2);
    expect(c.vendedores_distintos).toBe(4);
    expect(c.estabelecidos).toBe(2);
    // proporcao é sobre ESTABELECIDOS (2 de 2), nunca sobre os 4 distintos — mesma população do rótulo
    expect(c.proporcao).toBe(1);
    expect(c.rotulo).toContain('2 de 2 vendedores estabelecidos com estimativa mensal');
    expect(c.rotulo).not.toContain('365');
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

  it('proporcao e rótulo usam a mesma população — nunca estabelecidos sobre população crua', () => {
    // 6 no catálogo, 2 estabelecidos, os 2 com estimativa. O defeito seria devolver 2/6 = 33%.
    const ids = ['g1', 'g2', 'f1', 'f2', 'f3', 'f4'];
    const serie = [
      ...serieTipica('g1'), ...serieTipica('g2'),
      ...['f1', 'f2', 'f3', 'f4'].flatMap((v) => snap(v, 10, 30)),
    ];
    const c = calcularCoberturaEstimativa(ids, serie, 20, 6);
    expect(c.vendedores_distintos).toBe(6);
    expect(c.estabelecidos).toBe(2);
    expect(c.com_estimativa).toBe(2);
    expect(c.proporcao).toBe(1);
    expect(c.rotulo).toContain('2 de 2 vendedores estabelecidos');
  });
});

describe('calcularVendedoresSemEstimativa — contrato 3.4', () => {
  it('conta serie_insuficiente e sem_estimativa_no_periodo, só entre estabelecidos', () => {
    const serie = [
      ...serieTipica('ok'),
      { seller_id: 'insuf', transactions_total: 100, dia: '2026-08-01' },
      ...snap('neg', 20_000, 15_125, '2026-08-16', '2026-08-29'),
    ];
    // 'nunca-visto' não tem série: não é estabelecido (ADR-0145 D-1), sai do denominador inteiro.
    const r = calcularVendedoresSemEstimativa(['ok', 'insuf', 'neg', 'nunca-visto'], serie);
    expect(r.contagem).toBe(2);
    expect(r.rotulo).not.toMatch(/venderam/i);
    expect(r.rotulo).toContain('sem estimativa mensal');
  });

  it('vendedor abaixo de 50 no primeiro snapshot não entra na conta (critério aceite 1)', () => {
    const serie = snap('pequeno', 10, 12);
    const r = calcularVendedoresSemEstimativa(['pequeno'], serie);
    expect(r.contagem).toBe(0);
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
