import { afterEach, describe, it, expect, vi } from 'vitest';
import { resolverJanela, periodoFromParams, periodoToParams, janelaAnterior } from '@/lib/metricas';

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

afterEach(() => {
  vi.useRealTimers();
});

describe('resolverJanela', () => {
  it('preset: janela de ~N dias terminando agora', () => {
    const { desde, ate } = resolverJanela({ tipo: 'preset', dias: 30 });
    const delta = new Date(ate).getTime() - new Date(desde).getTime();
    expect(Math.round(delta / 86_400_000)).toBe(30);
  });

  it('range: cobre do início ao fim do dia (local)', () => {
    const { desde, ate } = resolverJanela({ tipo: 'range', desde: '2026-05-01', ate: '2026-05-03' });
    expect(new Date(desde).getTime()).toBe(new Date('2026-05-01T00:00:00').getTime());
    expect(new Date(ate).getTime()).toBe(new Date('2026-05-03T23:59:59.999').getTime());
  });

  it('mes_atual: cobre do primeiro dia do mês até agora', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-16T15:30:00'));
    const { desde, ate } = resolverJanela({ tipo: 'mes_atual' });
    expect(new Date(desde).getTime()).toBe(new Date('2026-07-01T00:00:00').getTime());
    expect(new Date(ate).getTime()).toBe(new Date('2026-07-16T15:30:00').getTime());
  });
});

describe('resolverJanela — range incompleto', () => {
  it('não lança e devolve janela vazia quando as datas estão vazias', () => {
    expect(() => resolverJanela({ tipo: 'range', desde: '', ate: '' })).not.toThrow();
    const j = resolverJanela({ tipo: 'range', desde: '', ate: '' });
    expect(j.desde).toBe(j.ate); // janela degenerada → sem vendas
  });
  it('resolve um range válido normalmente', () => {
    const j = resolverJanela({ tipo: 'range', desde: '2026-06-01', ate: '2026-06-10' });
    expect(j.desde < j.ate).toBe(true);
  });
});

describe('janelaAnterior', () => {
  it('devolve a janela anterior de mesma duração', () => {
    const j = { desde: '2026-06-01T00:00:00.000Z', ate: '2026-06-11T00:00:00.000Z' }; // 10 dias
    const a = janelaAnterior(j);
    expect(a.ate).toBe('2026-06-01T00:00:00.000Z');
    expect(a.desde).toBe('2026-05-22T00:00:00.000Z');
  });

  it('"hoje": compara com ontem no mesmo horário, não desloca pela duração decorrida (bug real)', () => {
    // "hoje" cresce o dia todo — deslocar pela duração decorrida (ex.: 12h) dá um pedaço de
    // ontem colado à meia-noite (ontem 12:00→24:00), não "ontem até a mesma hora de agora".
    const j = { desde: '2026-07-06T00:00:00.000Z', ate: '2026-07-06T12:00:00.000Z' }; // hoje, 12h decorridas
    const semTipo = janelaAnterior(j); // comportamento genérico (bug): desloca pelas 12h decorridas
    expect(semTipo).toEqual({ desde: '2026-07-05T12:00:00.000Z', ate: '2026-07-06T00:00:00.000Z' });

    const a = janelaAnterior(j, { tipo: 'hoje' }); // fix: ontem, mesmo ponto do relógio
    expect(a).toEqual({ desde: '2026-07-05T00:00:00.000Z', ate: '2026-07-05T12:00:00.000Z' });
  });
});

describe('periodo <-> params', () => {
  const mk = (o: Record<string, string>) => (k: string) => o[k] ?? null;

  it('preset ida e volta', () => {
    expect(periodoToParams({ tipo: 'preset', dias: 7 })).toEqual({ dias: '7' });
    expect(periodoFromParams(mk({ dias: '7' }))).toEqual({ tipo: 'preset', dias: 7 });
  });

  it('mes_atual ida e volta', () => {
    expect(periodoToParams({ tipo: 'mes_atual' })).toEqual({ periodo: 'mes_atual' });
    expect(periodoFromParams(mk({ periodo: 'mes_atual' }))).toEqual({ tipo: 'mes_atual' });
  });

  it('range ida e volta', () => {
    expect(periodoToParams({ tipo: 'range', desde: '2026-05-01', ate: '2026-05-10' }))
      .toEqual({ de: '2026-05-01', ate: '2026-05-10' });
    expect(periodoFromParams(mk({ de: '2026-05-01', ate: '2026-05-10' })))
      .toEqual({ tipo: 'range', desde: '2026-05-01', ate: '2026-05-10' });
  });

  it('default 30 dias quando ausente ou inválido (de > ate)', () => {
    expect(periodoFromParams(mk({}))).toEqual({ tipo: 'preset', dias: 30 });
    expect(periodoFromParams(mk({ de: '2026-05-10', ate: '2026-05-01' }))).toEqual({ tipo: 'preset', dias: 30 });
  });
});
