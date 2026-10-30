import { describe, expect, it } from 'vitest';
import { indicadoresAds } from '../../src/lib/ads-metricas';
import type { BlocoAdsMetricas } from '../../supabase/functions/_shared/ads/metricas';

const ok = (valor: number) => ({ valor, motivo: null });
type Resumo = BlocoAdsMetricas['resumo'];
const resumo = (o: Resumo = {}): Resumo => ({
  cost: ok(100), total_amount: ok(500), advertising_items_quantity: ok(7), units_quantity: ok(12),
  prints: ok(10_000), clicks: ok(200), cvr: ok(3.5), ...o,
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
    expect(indicadoresAds(resumo(), 2000).conversao).toEqual(ok(0.035));
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
