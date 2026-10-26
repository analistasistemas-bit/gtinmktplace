import { afterEach, describe, expect, it, vi } from 'vitest';
import { diaBrt, janela30Dias, janelaDia, janelasMesCorrente, janelasMesFechado } from '../janelas.ts';
import { janelaAnterior, MES_ATUAL, resolverJanela } from '../../../../../../src/lib/metricas';

afterEach(() => vi.useRealTimers());

describe('janelas BRT', () => {
  it('mês corrente do meio do mês', () => {
    const j = janelasMesCorrente(new Date('2026-10-24T17:00:00Z'));
    expect(j.mes).toEqual({ desde: '2026-10-01T00:00:00-03:00', ate: '2026-10-24T17:00:00.000Z' });
    expect(j.anterior).toEqual({ desde: '2026-09-01T00:00:00-03:00', ate: '2026-09-25T00:00:00-03:00' });
    expect(j.rotuloMes).toBe('Outubro');
    expect(j.rotuloAnterior).toBe('1–24/set');
  });

  it('meia-noite exata do dia 1', () => {
    const j = janelasMesCorrente(new Date('2026-11-01T03:00:00Z'));
    expect(j.mes.desde).toBe('2026-11-01T00:00:00-03:00');
    expect(j.rotuloAnterior).toBe('1–1/out');
  });

  it('mês fechado com clamp e virada de ano', () => {
    const j = janelasMesFechado('2026-10-31');
    expect(j.mes).toEqual({ desde: '2026-10-01T00:00:00-03:00', ate: '2026-11-01T00:00:00-03:00' });
    expect(j.anterior.ate).toBe('2026-10-01T00:00:00-03:00');
    expect(j.rotuloAnterior).toBe('1–30/set');
    expect(janelasMesFechado('2026-10-23').anterior.ate).toBe('2026-09-24T00:00:00-03:00');
    expect(janelasMesFechado('2027-01-05').anterior.desde).toBe('2026-12-01T00:00:00-03:00');
  });

  it('diaBrt e janelaDia', () => {
    expect(diaBrt(new Date('2026-10-25T02:59:00Z'))).toBe('2026-10-24');
    expect(diaBrt(new Date('2026-10-25T03:01:00Z'))).toBe('2026-10-25');
    expect(janelaDia('2026-10-23')).toEqual({ desde: '2026-10-23T00:00:00-03:00', ate: '2026-10-24T00:00:00-03:00' });
  });

  it('janela de 30 dias: início BRT de dia − 29 até o fim do dia', () => {
    const j = janela30Dias('2026-10-24');
    expect(Date.parse(j.desde)).toBe(Date.parse('2026-09-25T03:00:00Z'));
    expect(Date.parse(j.ate)).toBe(Date.parse('2026-10-25T03:00:00Z'));
    expect(Date.parse(janela30Dias('2027-01-10').desde)).toBe(Date.parse('2026-12-12T03:00:00Z'));
  });

  it('paridade com a tela', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T17:00:00Z'));
    const agora = new Date();
    const tela = janelaAnterior(resolverJanela(MES_ATUAL), MES_ATUAL);
    expect(Date.parse(janelasMesCorrente(agora).anterior.ate)).toBe(Date.parse(tela.ate) + 1);
  });
});
