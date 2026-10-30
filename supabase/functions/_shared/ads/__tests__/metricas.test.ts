import { describe, expect, it } from 'vitest';
import { CAMPOS_METRICA_ADS, ESCALA_METRICA_ADS, parseMetricasResumo } from '../metricas.ts';

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
