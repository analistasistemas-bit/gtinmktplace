import { describe, expect, it } from 'vitest';
import { diaDeHoje, diasAColetar, parametrosJanela } from '../janelas.ts';

describe('diaDeHoje', () => {
  it('BRT: madrugada UTC ainda é o dia anterior local', () => {
    expect(diaDeHoje(new Date('2026-09-27T02:30:00Z'), 'brt')).toBe('2026-09-26');
  });

  it('UTC: usa o dia UTC direto', () => {
    expect(diaDeHoje(new Date('2026-09-27T02:30:00Z'), 'utc')).toBe('2026-09-27');
  });
});

describe('diasAColetar', () => {
  it('carga inicial: 150 dias corridos terminando hoje', () => {
    const { desde, ate } = diasAColetar({ hoje: '2026-09-27', cargaInicialConcluida: false, ultimoDiaOk: null });
    expect(desde).toBe('2026-05-01');
    expect(ate).toBe('2026-09-27');
    expect(parametrosJanela({ desde, ate })).toEqual({ last: 149, ending: '2026-09-27' });
  });

  it('incremental sem gap: janela móvel de 7 dias', () => {
    const { desde, ate } = diasAColetar({ hoje: '2026-09-27', cargaInicialConcluida: true, ultimoDiaOk: '2026-09-26' });
    expect(desde).toBe('2026-09-21');
    expect(ate).toBe('2026-09-27');
  });

  it('incremental com gap > 7 dias: estende até o dia seguinte ao último ok', () => {
    const { desde, ate } = diasAColetar({ hoje: '2026-09-27', cargaInicialConcluida: true, ultimoDiaOk: '2026-09-10' });
    expect(desde).toBe('2026-09-11');
    expect(ate).toBe('2026-09-27');
  });

  it('incremental sem ultimoDiaOk: janela móvel de 7 dias', () => {
    const { desde } = diasAColetar({ hoje: '2026-09-27', cargaInicialConcluida: true, ultimoDiaOk: null });
    expect(desde).toBe('2026-09-21');
  });

  it('gap nunca passa dos 150 dias corridos', () => {
    const { desde } = diasAColetar({ hoje: '2026-09-27', cargaInicialConcluida: true, ultimoDiaOk: '2026-01-01' });
    expect(desde).toBe('2026-05-01');
  });
});

describe('parametrosJanela', () => {
  it('espelha o achado do spike: last=10&ending=2026-09-20 cobre 09-10..09-20', () => {
    expect(parametrosJanela({ desde: '2026-09-10', ate: '2026-09-20' })).toEqual({ last: 10, ending: '2026-09-20' });
  });
});
