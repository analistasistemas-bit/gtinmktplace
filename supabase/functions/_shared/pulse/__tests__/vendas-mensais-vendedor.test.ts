import { describe, expect, it } from 'vitest';
import {
  diasDecorridos,
  estimarVendasMensais,
  mediaMensal12m,
  medianaVendasMensaisDoUniverso,
  totalMaisRecentePorVendedor,
} from '../vendas-mensais-vendedor.ts';

describe('estimarVendasMensais — ADR-0142 critérios de aceite', () => {
  // 1. Delta negativo (−4875) → sem_estimativa_no_periodo
  it('delta negativo (−4875) devolve sem_estimativa_no_periodo', () => {
    const serie = [
      { seller_id: '12345', transactions_total: 20_000, dia: '2026-08-16' },
      { seller_id: '12345', transactions_total: 15_125, dia: '2026-08-29' },
    ];
    const r = estimarVendasMensais(serie).get('12345');
    expect(r).toEqual({ estado: 'sem_estimativa_no_periodo' });
    expect(r).not.toEqual({ estado: 'valor', vendas_mes: 0, dias_janela: 13 });
  });

  // 2. Um único snapshot → serie_insuficiente
  it('vendedor com um único snapshot devolve serie_insuficiente', () => {
    const r = estimarVendasMensais([
      { seller_id: 999, transactions_total: 500, dia: '2026-08-20' },
    ]).get('999');
    expect(r).toEqual({ estado: 'serie_insuficiente' });
  });

  // 3. Mesma taxa diária em janelas diferentes → mesmo vendas_mes
  it('janelas de tamanhos diferentes com mesma taxa diária produzem o mesmo vendas_mes', () => {
    const janela10 = estimarVendasMensais([
      { seller_id: 'a', transactions_total: 1000, dia: '2026-08-01' },
      { seller_id: 'a', transactions_total: 1030, dia: '2026-08-11' },
    ]).get('a');
    const janela20 = estimarVendasMensais([
      { seller_id: 'b', transactions_total: 2000, dia: '2026-08-01' },
      { seller_id: 'b', transactions_total: 2060, dia: '2026-08-21' },
    ]).get('b');
    expect(janela10).toMatchObject({ estado: 'valor', vendas_mes: 90, dias_janela: 10 });
    expect(janela20).toMatchObject({ estado: 'valor', vendas_mes: 90, dias_janela: 20 });
  });

  // 4. Agregação usa mediana, não média
  it('medianaVendasMensaisDoUniverso usa mediana — média seria diferente', () => {
    const base = (sellerId: string, delta: number) => [
      { seller_id: sellerId, transactions_total: 100, dia: '2026-08-01' },
      { seller_id: sellerId, transactions_total: 100 + delta, dia: '2026-08-31' },
    ];
    const resultados = estimarVendasMensais([
      ...base('tipico-a', 21),
      ...base('tipico-b', 21),
      ...base('tipico-c', 21),
      ...base('outlier', 3553),
    ]);
    const mediana = medianaVendasMensaisDoUniverso(resultados);
    const valores = [...resultados.values()]
      .filter((r): r is Extract<typeof r, { estado: 'valor' }> => r.estado === 'valor')
      .map((r) => r.vendas_mes);
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;

    expect(mediana).toBeCloseTo(21, 0);
    expect(media).toBeGreaterThan(500);
    expect(mediana).not.toBeCloseTo(media, 0);
  });

  it('delta zero com dois snapshots devolve valor com vendas_mes zero', () => {
    const r = estimarVendasMensais([
      { seller_id: 'parado', transactions_total: 500, dia: '2026-08-10' },
      { seller_id: 'parado', transactions_total: 500, dia: '2026-08-20' },
    ]).get('parado');
    expect(r).toEqual({ estado: 'valor', vendas_mes: 0, dias_janela: 10 });
  });

  it('dois snapshots no mesmo dia usa dias_janela = 1', () => {
    const r = estimarVendasMensais([
      { seller_id: 'x', transactions_total: 100, dia: '2026-08-15' },
      { seller_id: 'x', transactions_total: 110, dia: '2026-08-15' },
    ]).get('x');
    expect(r).toEqual({ estado: 'valor', vendas_mes: 300, dias_janela: 1 });
  });

  it('normaliza seller_id numérico e string para a mesma chave', () => {
    const r1 = estimarVendasMensais([
      { seller_id: 42, transactions_total: 10, dia: '2026-08-01' },
      { seller_id: 42, transactions_total: 20, dia: '2026-08-11' },
    ]);
    const r2 = estimarVendasMensais([
      { seller_id: '42', transactions_total: 10, dia: '2026-08-01' },
      { seller_id: '42', transactions_total: 20, dia: '2026-08-11' },
    ]);
    expect(r1.get('42')).toEqual(r2.get('42'));
  });
});

describe('diasDecorridos', () => {
  it('conta dias de calendário entre duas datas', () => {
    expect(diasDecorridos('2026-08-16', '2026-08-29')).toBe(13);
  });

  it('mesmo dia retorna 1', () => {
    expect(diasDecorridos('2026-08-20', '2026-08-20')).toBe(1);
  });
});

describe('medianaVendasMensaisDoUniverso', () => {
  it('retorna null quando não há valores', () => {
    const resultados = estimarVendasMensais([
      { seller_id: 'a', transactions_total: 100, dia: '2026-08-01' },
    ]);
    expect(medianaVendasMensaisDoUniverso(resultados)).toBeNull();
  });
});

describe('mediaMensal12m — ADR-0146 D-1', () => {
  it('divide o total mais recente por 12', () => {
    expect(mediaMensal12m(3_864)).toBe(322);
  });

  it('total zero devolve média zero, não ausência', () => {
    expect(mediaMensal12m(0)).toBe(0);
  });
});

describe('totalMaisRecentePorVendedor — ADR-0146 D-2', () => {
  it('pega o total do ÚLTIMO snapshot da série ordenada, não o primeiro', () => {
    const totais = totalMaisRecentePorVendedor([
      { seller_id: 'a', transactions_total: 100, dia: '2026-08-01' },
      { seller_id: 'a', transactions_total: 121, dia: '2026-08-31' },
    ]);
    expect(totais.get('a')).toBe(121);
  });

  it('um único snapshot já basta — não exige série de 2 pontos', () => {
    const totais = totalMaisRecentePorVendedor([
      { seller_id: 'solo', transactions_total: 500, dia: '2026-08-20' },
    ]);
    expect(totais.get('solo')).toBe(500);
  });

  it('delta negativo não é excluído: o total mais recente entra igual', () => {
    const totais = totalMaisRecentePorVendedor([
      { seller_id: 'neg', transactions_total: 20_000, dia: '2026-08-16' },
      { seller_id: 'neg', transactions_total: 15_125, dia: '2026-08-29' },
    ]);
    expect(totais.get('neg')).toBe(15_125);
  });
});
