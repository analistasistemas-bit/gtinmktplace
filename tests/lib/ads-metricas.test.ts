import { describe, expect, it } from 'vitest';
import { compararIndicadorAds, indicadoresAds } from '../../src/lib/ads-metricas';
import type { BlocoAdsMetricas } from '../../supabase/functions/_shared/ads/metricas';

const ok = (valor: number) => ({ valor, motivo: null });
type Resumo = BlocoAdsMetricas['resumo'];
const resumo = (o: Resumo = {}): Resumo => ({
  cost: ok(100), total_amount: ok(500), advertising_items_quantity: ok(7), units_quantity: ok(12),
  prints: ok(10_000), clicks: ok(200), cvr: ok(4.2), ...o,
});

describe('indicadores do Mercado Ads', () => {
  it('calcula razões sobre os agregados do período', () => {
    const r = indicadoresAds(resumo(), 2000);
    expect(r.investimento).toEqual(ok(100));
    expect(r.roas).toEqual(ok(5));
    expect(r.acos).toEqual(ok(0.2));
    expect(r.tacos).toEqual(ok(0.05));
    expect(r.impressoes).toEqual(ok(10_000));
    expect(r.cliques).toEqual(ok(200));
    expect(r.ctr).toEqual(ok(0.02));
    expect(r.cpc).toEqual(ok(0.5));
  });

  it('vendas por Ads é a quantidade atribuída, não unidades nem receita', () => {
    const r = indicadoresAds(resumo(), 2000);
    expect(r.vendas).toEqual(ok(7));
    expect(r.receita).toEqual(ok(500));
  });

  it('conversão é o CVR nativo normalizado de percentual para fração', () => {
    expect(indicadoresAds(resumo(), 2000).conversao).toEqual(ok(0.042));
  });

  it('conversão ausente fica indisponível, sem recalcular', () => {
    const r = indicadoresAds(resumo({ cvr: { valor: null, motivo: 'nao_retornada' } }), 2000);
    expect(r.conversao).toEqual({ valor: null, motivo: 'nao_retornada' });
    const sem = resumo();
    delete sem.cvr;
    expect(indicadoresAds(sem, 2000).conversao).toEqual({ valor: null, motivo: 'nao_retornada' });
  });

  it('denominador zero devolve sem_denominador', () => {
    const r = indicadoresAds(resumo({ cost: ok(0), total_amount: ok(0), prints: ok(0), clicks: ok(0) }), 2000);
    for (const k of ['roas', 'acos', 'ctr', 'cpc']) expect(r[k]).toEqual({ valor: null, motivo: 'sem_denominador' });
  });

  it('TACOS sem faturamento (null ou 0) fica indisponível com motivo', () => {
    for (const f of [null, 0]) {
      expect(indicadoresAds(resumo(), f).tacos).toEqual({ valor: null, motivo: 'sem_denominador' });
    }
  });

  it('insumo indisponível propaga o motivo do insumo', () => {
    const r = indicadoresAds(resumo({ cost: { valor: null, motivo: 'fora_da_retencao' } }), 2000);
    expect(r.investimento).toEqual({ valor: null, motivo: 'fora_da_retencao' });
    for (const k of ['roas', 'acos', 'tacos', 'cpc']) expect(r[k]).toEqual({ valor: null, motivo: 'fora_da_retencao' });
    expect(r.ctr).toEqual(ok(0.02));
  });
});

describe('comparacao honesta entre períodos', () => {
  const nd = { valor: null, motivo: 'nao_retornada' as const };
  it('quantidade/moeda/razão usam variação percentual', () => {
    expect(compararIndicadorAds(ok(112), ok(100), 'moeda', false)).toEqual({ texto: '+12%', direcao: 'up', tom: 'neutral' });
    expect(compararIndicadorAds(ok(80), ok(100), 'quantidade', false)).toEqual({ texto: '-20%', direcao: 'down', tom: 'neutral' });
  });
  it('percentual usa diferença em p.p.', () => {
    expect(compararIndicadorAds(ok(0.062), ok(0.05), 'percentual', false).texto).toBe('+1,2 p.p.');
  });
  it.each(['moeda', 'quantidade', 'razao', 'percentual'] as const)('base zero em %s vira "Sem base de comparação" e neutra', (u) => {
    expect(compararIndicadorAds(ok(0.05), ok(0), u, false, 'maior_melhor'))
      .toEqual({ texto: 'Sem base de comparação', direcao: 'neutral', tom: 'neutral' });
  });
  it('base negativa em moeda usa diferença em R$', () => {
    expect(compararIndicadorAds(ok(20), ok(-100), 'moeda', false).texto).toBe('+R$ 120,00');
    expect(compararIndicadorAds(ok(-150), ok(-100), 'moeda', false).texto).toBe('-R$ 50,00');
  });
  it('lado indisponível é "Sem comparação" neutro', () => {
    const r = { texto: 'Sem comparação', direcao: 'neutral', tom: 'neutral' };
    expect(compararIndicadorAds(nd, ok(1), 'moeda', false, 'maior_melhor')).toEqual(r);
    expect(compararIndicadorAds(ok(1), nd, 'moeda', false, 'maior_melhor')).toEqual(r);
  });
  it('tom segue o sentido do indicador; direção fica separada', () => {
    expect(compararIndicadorAds(ok(6), ok(5), 'razao', false, 'maior_melhor')).toMatchObject({ direcao: 'up', tom: 'success' });
    expect(compararIndicadorAds(ok(4), ok(5), 'razao', false, 'maior_melhor')).toMatchObject({ direcao: 'down', tom: 'danger' });
    expect(compararIndicadorAds(ok(0.15), ok(0.2), 'percentual', false, 'menor_melhor')).toMatchObject({ direcao: 'down', tom: 'success' });
    expect(compararIndicadorAds(ok(0.25), ok(0.2), 'percentual', false, 'menor_melhor')).toMatchObject({ direcao: 'up', tom: 'danger' });
  });
  it('provisória mantém a direção e força tom neutro', () => {
    expect(compararIndicadorAds(ok(6), ok(5), 'razao', true, 'maior_melhor')).toMatchObject({ direcao: 'up', tom: 'neutral' });
  });
});
