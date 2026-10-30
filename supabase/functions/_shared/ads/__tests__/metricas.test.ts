import { describe, expect, it } from 'vitest';
import type { EscopoAdsMetricas, PedidoAdsMetricas } from '../metricas.ts';
import {
  CAMPOS_METRICA_ADS, ESCALA_METRICA_ADS, parseMetricasResumo, parseSerieMetricas,
  urlAnunciosMetricas, urlCampanhaDetalhe, urlCampanhaSerie, urlContaResumo, urlContaSerie,
} from '../metricas.ts';

describe('parseMetricasResumo', () => {
  it('campo ausente é null com motivo nao_retornada', () => {
    const campoAusente = parseMetricasResumo({ cost: 10 }).clicks!;
    expect(campoAusente.valor).toBeNull();
    expect(campoAusente.motivo).toBe('nao_retornada');
  });

  it('zero explícito é 0, sem motivo', () => {
    const zeroExplicito = parseMetricasResumo({ clicks: 0 }).clicks!;
    expect(zeroExplicito.valor).toBe(0);
    expect(zeroExplicito.motivo).toBeNull();
  });

  it('número válido preserva a unidade do fornecedor', () => {
    const r = parseMetricasResumo({ cost: 12.5, cvr: 10.31, impression_share: 0.42 });
    expect(r.cost).toEqual({ valor: 12.5, motivo: null });
    expect(r.cvr!.valor).toBe(10.31);
    expect(r.impression_share!.valor).toBe(0.42);
  });

  it.each([
    ['boolean', true],
    ['string', '12'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['null', null],
    ['objeto', {}],
  ])('%s é resposta_invalida', (_nome, v) => {
    expect(parseMetricasResumo({ cost: v }).cost).toEqual({ valor: null, motivo: 'resposta_invalida' });
  });

  it('top_impression_share é sempre resposta_invalida (escala não confirmada)', () => {
    expect(parseMetricasResumo({ top_impression_share: 0.5 }).top_impression_share)
      .toEqual({ valor: null, motivo: 'resposta_invalida' });
  });

  it('entrada que não é objeto invalida todos os campos', () => {
    for (const entrada of [null, 'x', [], 3]) {
      const r = parseMetricasResumo(entrada);
      for (const c of CAMPOS_METRICA_ADS) expect(r[c]).toEqual({ valor: null, motivo: 'resposta_invalida' });
    }
  });

  it('todo campo tem escala declarada', () => {
    for (const c of CAMPOS_METRICA_ADS) expect(ESCALA_METRICA_ADS[c]).toBeDefined();
    expect(ESCALA_METRICA_ADS.cvr).toBe('percentual_0_100');
    expect(ESCALA_METRICA_ADS.lost_impression_share_by_budget).toBe('fracao_0_1');
    expect(ESCALA_METRICA_ADS.top_impression_share).toBe('nao_confirmada');
  });
});

describe('contrato de pedido', () => {
  it('escopo é a união da seção 5.2 e o pedido aceita os campos da spec', () => {
    const escopos: EscopoAdsMetricas[] = ['conta', 'campanhas', 'campanha', 'competitividade'];
    const pedido: PedidoAdsMetricas = {
      desde: '2026-10-01', ate: '2026-10-07', comparar: 'anterior', escopo: 'campanha', campanhaId: 1, fresco: true,
    };
    // @ts-expect-error escopo fora da união
    const invalido: EscopoAdsMetricas = 'outro';
    expect(escopos).toContain(pedido.escopo);
    expect(invalido).toBe('outro');
  });
});

describe('serie diária', () => {
  const janela = { desde: '2026-10-01', ate: '2026-10-03' };
  const dia = (date: unknown, extra: Record<string, unknown> = { cost: 1 }) => ({ date, ...extra });
  const corpo = (...results: unknown[]) => ({ results });

  it('serie íntegra: um dia por data, ordenada, completo=true', () => {
    const r = parseSerieMetricas(corpo(dia('2026-10-03'), dia('2026-10-01'), dia('2026-10-02')), janela);
    expect(r.completo).toBe(true);
    expect(r.serie.map((d) => d.dia)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(r.serie[0].metricas.cost).toEqual({ valor: 1, motivo: null });
  });

  it('serie com zero explícito continua válida', () => {
    const r = parseSerieMetricas(
      corpo(dia('2026-10-01', { cost: 0, clicks: 0 }), dia('2026-10-02'), dia('2026-10-03')), janela);
    expect(r.completo).toBe(true);
    expect(r.serie[0].metricas.clicks).toEqual({ valor: 0, motivo: null });
  });

  it('serie com lacuna: completo=false, sem preencher com zero', () => {
    const r = parseSerieMetricas(corpo(dia('2026-10-01'), dia('2026-10-03')), janela);
    expect(r.completo).toBe(false);
    expect(r.serie.map((d) => d.dia)).toEqual(['2026-10-01', '2026-10-03']);
  });

  it('serie com duplicata invalida a série', () => {
    const r = parseSerieMetricas(corpo(dia('2026-10-01'), dia('2026-10-01'), dia('2026-10-02'), dia('2026-10-03')), janela);
    expect(r).toEqual({ serie: [], completo: false });
  });

  it('serie com data fora da janela invalida a série', () => {
    const r = parseSerieMetricas(corpo(dia('2026-10-01'), dia('2026-10-02'), dia('2026-10-03'), dia('2026-10-04')), janela);
    expect(r).toEqual({ serie: [], completo: false });
  });

  it.each([
    ['cost ausente', { clicks: 1 }],
    ['cost inválido', { cost: '1' }],
    ['cost NaN', { cost: Number.NaN }],
  ])('serie com %s invalida a série', (_n, extra) => {
    const r = parseSerieMetricas(corpo(dia('2026-10-01', extra), dia('2026-10-02'), dia('2026-10-03')), janela);
    expect(r).toEqual({ serie: [], completo: false });
  });

  it('serie com data inexistente no calendário não completa a janela', () => {
    const j = { desde: '2026-09-30', ate: '2026-10-01' };
    const r = parseSerieMetricas(corpo(dia('2026-09-30'), dia('2026-09-31')), j);
    expect(r).toEqual({ serie: [], completo: false });
  });

  it('serie com sufixo na data invalida a série', () => {
    const r = parseSerieMetricas(corpo(dia('2026-10-01INVALIDO'), dia('2026-10-02'), dia('2026-10-03')), janela);
    expect(r).toEqual({ serie: [], completo: false });
  });

  it.each([
    ['sem results', {}],
    ['results não é array', { results: {} }],
    ['corpo nulo', null],
    ['data não string', corpo(dia(20261001), dia('2026-10-02'), dia('2026-10-03'))],
    ['data malformada', corpo(dia('01/10/2026'))],
  ])('serie com envelope inválido (%s) → vazia e incompleta', (_n, c) => {
    expect(parseSerieMetricas(c, janela)).toEqual({ serie: [], completo: false });
  });
});

describe('URLs das métricas por período', () => {
  const j = { desde: '2026-09-30', ate: '2026-10-29' };
  const COMP = ['impression_share', 'top_impression_share', 'lost_impression_share_by_budget', 'lost_impression_share_by_ad_rank'];
  const q = (u: string) => new URL(`https://x${u}`).searchParams;
  const metricas = (u: string) => (q(u).get('metrics') ?? '').split(',');

  it('E1 resumo da conta: datas, resumo, status confirmados, limit 50, sem competitividade', () => {
    const u = urlContaResumo(123, j, 0);
    expect(u.startsWith('/marketplace/advertising/MLB/advertisers/123/product_ads/campaigns/search?')).toBe(true);
    expect(q(u).get('date_from')).toBe('2026-09-30');
    expect(q(u).get('date_to')).toBe('2026-10-29');
    expect(q(u).get('metrics_summary')).toBe('true');
    expect(q(u).get('filters[status]')).toBe('active,paused,deleted,error');
    expect(q(u).get('limit')).toBe('50');
    expect(q(u).get('offset')).toBe('0');
    expect(metricas(u)).toContain('cost');
    expect(metricas(u)).toContain('organic_units_amount');
    for (const c of COMP) expect(metricas(u)).not.toContain(c);
    expect(q(u).has('aggregation_type')).toBe(false);
  });

  it('E2 série da conta: DAILY, sem competitividade, sem resumo', () => {
    const u = urlContaSerie(123, j);
    expect(u).toContain('/advertisers/123/product_ads/campaigns/search?');
    expect(q(u).get('aggregation_type')).toBe('DAILY');
    expect(q(u).get('filters[status]')).toBe('active,paused,deleted,error');
    expect(q(u).has('metrics_summary')).toBe(false);
    for (const c of COMP) expect(metricas(u)).not.toContain(c);
  });

  it('E3/E4 detalhe e série da campanha: rota sem advertiser, competitividade só aqui', () => {
    const d = urlCampanhaDetalhe(77, j);
    const s = urlCampanhaSerie(77, j);
    for (const u of [d, s]) {
      expect(u.startsWith('/marketplace/advertising/MLB/product_ads/campaigns/77?')).toBe(true);
      expect(u).not.toContain('advertisers');
      expect(q(u).get('date_from')).toBe('2026-09-30');
      for (const c of COMP) expect(metricas(u)).toContain(c);
    }
    expect(q(d).has('aggregation_type')).toBe(false);
    expect(q(s).get('aggregation_type')).toBe('DAILY');
  });

  it('E1–E4 nunca usam /ads/search; E5 é builder próprio, com filtro de campanha e sem competitividade', () => {
    for (const u of [urlContaResumo(1, j, 0), urlContaSerie(1, j), urlCampanhaDetalhe(2, j), urlCampanhaSerie(2, j)]) {
      expect(u).not.toContain('/ads/search');
    }
    const u = urlAnunciosMetricas(123, j, 50, 99);
    expect(u.startsWith('/marketplace/advertising/MLB/advertisers/123/product_ads/ads/search?')).toBe(true);
    expect(q(u).get('filters[campaign_id]')).toBe('99');
    expect(q(u).get('limit')).toBe('50');
    expect(q(u).get('offset')).toBe('50');
    expect(metricas(u)).toContain('units_quantity');
    for (const c of COMP) expect(metricas(u)).not.toContain(c);
    expect(q(urlAnunciosMetricas(123, j, 0)).has('filters[campaign_id]')).toBe(false);
  });
});
