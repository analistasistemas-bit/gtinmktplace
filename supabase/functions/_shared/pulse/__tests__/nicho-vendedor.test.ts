import { describe, expect, it } from 'vitest';
import {
  calcularCoberturaEstimativa,
  calcularConcentracaoPorVendedor,
  calcularTendenciaNicho,
  calcularVendedoresForaDaConta,
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

/** Delta 21 em 30 dias → crescendo. Total mais recente = 121 → mediaMensal12m ≈ 10,08 */
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

describe('calcularVolumeNicho — contrato 3.2 (ADR-0146 D-1)', () => {
  it('usa o total do snapshot MAIS RECENTE ÷ 12, não o primeiro nem o delta — critério aceite 1', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    // t0 baixo, t1 alto: se a fórmula usasse o primeiro snapshot ou o delta, a mediana seria bem
    // menor que "t1 ÷ 12".
    const serie = ids.flatMap((v) => snap(v, 60, 1_200));
    const r = calcularVolumeNicho(ids, serie);
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.vendas_mes_mediana).toBeCloseTo(1_200 / 12, 6);
    expect(r.vendas_mes_mediana).not.toBeCloseTo((1_200 - 60) / 30, 0); // não é o delta extrapolado
  });

  it('usa mediana, nunca soma nem média', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const serie = [
      ...snap('a', 100, 110),
      ...snap('b', 100, 115),
      ...snap('c', 100, 120),
      ...snap('d', 100, 125),
      ...snap('e', 100, 120_100),
    ];
    const r = calcularVolumeNicho(ids, serie);
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    // medianas de total÷12: 110/12≈9.17, 115/12≈9.58, 120/12=10, 125/12≈10.42, outlier 10008.33
    expect(r.vendas_mes_mediana).toBeCloseTo(10, 0);
    expect(r.vendas_mes_mediana).not.toBeCloseTo(2007, 0); // média seria dominada pelo outlier
  });

  it('rótulo diz "média mensal dos últimos 12 meses" e nunca "movimento observado", '
    + '"extrapolado" ou "365" — critério aceite 6', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const r = calcularVolumeNicho(ids, ids.flatMap((v) => serieTipica(v)));
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.rotulo).toContain('média mensal dos últimos 12 meses');
    expect(r.rotulo).toContain('5 vendedores estabelecidos');
    expect(r.rotulo).not.toContain('movimento observado');
    expect(r.rotulo).not.toContain('extrapolado');
    expect(r.rotulo).not.toContain('365');
  });

  it('UNIDADE_VENDEDOR não cita "365" e mantém "catálogos desta amostra"', () => {
    expect(UNIDADE_VENDEDOR).toContain('catálogos desta amostra');
    expect(UNIDADE_VENDEDOR).not.toContain('365');
  });

  it('vendedor com UM ÚNICO snapshot entra normalmente — critério aceite 2', () => {
    const comSerie = ['a', 'b', 'c', 'd'].flatMap((v) => serieTipica(v));
    const solo = [{ seller_id: 'solo', transactions_total: 6_000, dia: '2026-08-20' }];
    const r = calcularVolumeNicho(['a', 'b', 'c', 'd', 'solo'], [...comSerie, ...solo]);
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.vendedores_com_estimativa).toBe(5);
    // 6000/12 = 500 é o maior valor do conjunto (os outros ~10.08) — mediana é a 3ª posição, ~10.08
    expect(r.vendas_mes_mediana).toBeCloseTo(121 / 12, 6);
  });

  it('vendedor com delta NEGATIVO entra normalmente, nunca é excluído — critério aceite 3', () => {
    const positivos = ['a', 'b', 'c', 'd'].flatMap((v) => serieTipica(v));
    // total mais recente do 'neg' (15125) domina a mediana se entrar — prova que ele não foi
    // descartado silenciosamente.
    const negativo = snap('neg', 20_000, 15_125, '2026-08-16', '2026-08-29');
    const r = calcularVolumeNicho(['a', 'b', 'c', 'd', 'neg'], [...positivos, ...negativo]);
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.vendedores_com_estimativa).toBe(5);
    expect(r.vendas_mes_mediana).toBeCloseTo(121 / 12, 6); // mediana continua sendo o típico
  });

  it('mediana zero é valor medido, nunca ausência', () => {
    // Estabelecido pelo PRIMEIRO snapshot (500 >= 50); o snapshot mais recente caiu a zero.
    const zerados = ['p1', 'p2', 'p3'].flatMap((v) => snap(v, 500, 0));
    const ativos = ['a1', 'a2'].flatMap((v) => serieTipica(v));
    const r = calcularVolumeNicho(['p1', 'p2', 'p3', 'a1', 'a2'], [...zerados, ...ativos]);
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.vendas_mes_mediana).toBe(0);
    expect(r.vendedores_com_estimativa).toBe(5);
  });

  it('sem vendedores estabelecidos devolve sem_dado', () => {
    const r = calcularVolumeNicho(['solo'], [{ seller_id: 'solo', transactions_total: 50, dia: '2026-08-15' }]);
    // total=50 é estabelecido (>=50) mas piso de 5 estabelecidos não é atingido
    expect(r.estado).toBe('sem_dado');
  });

  it('mediana de menos de 5 vendedores não vai para tela (piso D-5)', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const r = calcularVolumeNicho(ids, ids.flatMap((v) => serieTipica(v)));
    expect(r.estado).toBe('sem_dado');
    if (r.estado !== 'sem_dado') return;
    expect(r.mensagem).toContain('5');
  });

  it('sub-50 não entra na mediana nem no denominador do piso — regressão do corte de 50, '
    + 'critério aceite 8', () => {
    // 5 estabelecidos + 20 "fantasmas" sub-50 que nunca chegam a 50 no primeiro snapshot, com
    // total alto no snapshot mais recente. Sem o filtro, a cauda dominaria a mediana (mediana ≈ 1).
    const estabelecidosIds = ['a', 'b', 'c', 'd', 'e'];
    const estabelecidos = estabelecidosIds.flatMap((v) => snap(v, 3_000, 3_864)); // 3864/12 = 322
    const fantasmasIds = Array.from({ length: 20 }, (_, i) => `f${i}`);
    const fantasmas = fantasmasIds.flatMap((v) => snap(v, 10, 12)); // 12/12 = 1, mas sub-50: fora
    const r = calcularVolumeNicho(
      [...estabelecidosIds, ...fantasmasIds],
      [...estabelecidos, ...fantasmas],
    );
    expect(r.estado).toBe('valor');
    if (r.estado !== 'valor') return;
    expect(r.vendedores_com_estimativa).toBe(5);
    expect(r.vendas_mes_mediana).toBeCloseTo(322, 0);
    expect(r.vendas_mes_mediana).not.toBeCloseTo(1, 0);
  });

  it('vendedor único gigante não vira nicho (piso de 5)', () => {
    const r = calcularVolumeNicho(
      ['480265022'],
      snap('480265022', 31_347_465, 31_746_992, '2026-08-20', '2026-08-29'),
    );
    expect(r.estado).toBe('sem_dado');
  });
});

describe('vendedoresEstabelecidos — ADR-0145 D-1 (inalterado pela ADR-0146)', () => {
  it('total < 50 no primeiro snapshot fica fora', () => {
    const serie = snap('pequeno', 40, 45);
    expect(vendedoresEstabelecidos(['pequeno'], serie).size).toBe(0);
  });

  it('total >= 50 no primeiro snapshot entra', () => {
    const serie = snap('grande', 50, 60);
    expect(vendedoresEstabelecidos(['grande'], serie)).toEqual(new Set(['grande']));
  });

  it('filtro usa o PRIMEIRO snapshot: t0=40, t1=80 continua fora', () => {
    const serie = snap('cresceu', 40, 80);
    expect(vendedoresEstabelecidos(['cresceu'], serie).size).toBe(0);
  });

  it('vendedor sem série não é estabelecido', () => {
    expect(vendedoresEstabelecidos(['fantasma'], []).size).toBe(0);
  });
});

describe('calcularTendenciaNicho — contrato 3.6 (ADR-0146 D-3)', () => {
  it('classifica crescendo (delta > 0), estável (delta = 0) e encolhendo (delta < 0) — '
    + 'critério aceite 3/7', () => {
    const ids = ['a', 'b', 'c'];
    const serie = [
      ...serieTipica('a'), // delta 21 > 0 → crescendo
      ...snap('b', 100, 100), // delta 0 → estável
      ...snap('c', 20_000, 15_125, '2026-08-16', '2026-08-29'), // delta < 0 → encolhendo
    ];
    const t = calcularTendenciaNicho(ids, serie);
    expect(t.estabelecidos).toBe(3);
    expect(t.crescendo).toBe(1);
    expect(t.estaveis).toBe(1);
    expect(t.encolhendo).toBe(1);
    expect(t.sem_serie).toBe(0);
    // encolhendo NUNCA some da contagem (D-3) — continua presente em `estabelecidos`.
    expect(t.crescendo + t.estaveis + t.encolhendo).toBe(t.estabelecidos);
  });

  it('vendedor estável nunca é chamado de "não vendeu" ou "venderam" — critério aceite 7', () => {
    const ids = ['a', 'b'];
    const serie = [...serieTipica('a'), ...snap('b', 100, 100)];
    const t = calcularTendenciaNicho(ids, serie);
    expect(t.rotulo.toLowerCase()).not.toMatch(/venderam/);
    expect(t.rotulo.toLowerCase()).not.toMatch(/não vendeu/);
  });

  it('menos de 2 snapshots conta em sem_serie, não em nenhum dos três estados', () => {
    const ids = ['a', 'solo'];
    const serie = [
      ...serieTipica('a'),
      { seller_id: 'solo', transactions_total: 500, dia: '2026-08-20' },
    ];
    const t = calcularTendenciaNicho(ids, serie);
    expect(t.estabelecidos).toBe(2);
    expect(t.sem_serie).toBe(1);
    expect(t.crescendo).toBe(1);
    expect(t.proporcao_crescendo).toBe(1); // 1 crescendo de 1 comparável (2 - 1 sem_serie)
  });

  it('rotulo usa "comparaveis" = estabelecidos - sem_serie e cita "vendendo mais que há um ano"', () => {
    const ids = ['a', 'b', 'solo'];
    const serie = [
      ...serieTipica('a'),
      ...snap('b', 100, 100),
      { seller_id: 'solo', transactions_total: 500, dia: '2026-08-20' },
    ];
    const t = calcularTendenciaNicho(ids, serie);
    expect(t.estabelecidos).toBe(3);
    expect(t.sem_serie).toBe(1);
    expect(t.rotulo).toContain('1 de 2 vendedores estabelecidos vendendo mais que há um ano');
    expect(t.rotulo).toContain('comparado com os mesmos 30 dias de 12 meses atrás');
  });

  it('sem estabelecido nenhum devolve rótulo de ausência, sem base_pequena', () => {
    const t = calcularTendenciaNicho(['x'], snap('x', 10, 20));
    expect(t.estabelecidos).toBe(0);
    expect(t.base_pequena).toBe(false);
    expect(t.rotulo).toBe('nenhum vendedor estabelecido nos catálogos desta amostra');
  });

  it('base_pequena com 1 a 4 estabelecidos', () => {
    const ids = ['a', 'b', 'c'];
    const t = calcularTendenciaNicho(ids, ids.flatMap((v) => serieTipica(v)));
    expect(t.estabelecidos).toBe(3);
    expect(t.base_pequena).toBe(true);
  });

  it('vendedor abaixo de 50 no primeiro snapshot não entra', () => {
    const t = calcularTendenciaNicho(['pequeno'], snap('pequeno', 10, 40));
    expect(t.estabelecidos).toBe(0);
    expect(t.crescendo).toBe(0);
  });

  it('nenhum rótulo contém "365"', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const t = calcularTendenciaNicho(ids, ids.flatMap((v) => serieTipica(v)));
    expect(t.rotulo).not.toContain('365');
  });
});

describe('calcularCoberturaEstimativa — contrato 3.3', () => {
  it('reporta vendedores com estimativa / distintos / estabelecidos', () => {
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

  it('com um único snapshot, o vendedor já conta como "com estimativa" (ADR-0146 D-2)', () => {
    const c = calcularCoberturaEstimativa(
      ['solo'],
      [{ seller_id: 'solo', transactions_total: 500, dia: '2026-08-20' }],
      1,
      1,
    );
    expect(c.estabelecidos).toBe(1);
    expect(c.com_estimativa).toBe(1);
  });

  it('vendedor com delta negativo continua "com estimativa" (ADR-0146 D-3)', () => {
    const c = calcularCoberturaEstimativa(
      ['neg'],
      snap('neg', 20_000, 15_125, '2026-08-16', '2026-08-29'),
      1,
      1,
    );
    expect(c.estabelecidos).toBe(1);
    expect(c.com_estimativa).toBe(1);
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

describe('calcularVendedoresForaDaConta — contrato 3.4 (ADR-0146 Errata 1)', () => {
  it('declara quem a régua excluiu, em vez de dizer sempre zero', () => {
    const serie = [
      ...serieTipica('grande1'), ...serieTipica('grande2'),
      ...snap('pequeno1', 10, 12), ...snap('pequeno2', 3, 3), ...snap('pequeno3', 49, 60),
    ];
    const ids = ['grande1', 'grande2', 'pequeno1', 'pequeno2', 'pequeno3'];
    const r = calcularVendedoresForaDaConta(ids, serie);
    // pequeno3 tem t0=49: fica de fora mesmo cruzando 50 na janela (ADR-0145 D-1, critério 2)
    expect(r.contagem).toBe(3);
    expect(r.total_no_catalogo).toBe(5);
    expect(r.rotulo).toContain('3 de 5 concorrentes ficaram de fora');
    expect(r.rotulo).toContain('menos de 50 vendas na vida');
  });

  it('vendedor sem série nenhuma também conta como fora', () => {
    const r = calcularVendedoresForaDaConta(['visto', 'nunca-visto'], serieTipica('visto'));
    expect(r.contagem).toBe(1);
    expect(r.total_no_catalogo).toBe(2);
  });

  it('todos estabelecidos → rótulo próprio, não "0 de N"', () => {
    const r = calcularVendedoresForaDaConta(['a', 'b'], [...serieTipica('a'), ...serieTipica('b')]);
    expect(r.contagem).toBe(0);
    expect(r.rotulo).toBe('nenhum concorrente ficou de fora da conta');
  });

  it('nunca usa a palavra "venderam" para quem ficou de fora', () => {
    const r = calcularVendedoresForaDaConta(['p'], snap('p', 10, 12));
    expect(r.rotulo).not.toMatch(/venderam/i);
  });
});

describe('calcularConcentracaoPorVendedor — contrato 7.4 (não muda)', () => {
  it('agrupa por seller_id', () => {
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
