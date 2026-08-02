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

  it('"mes_atual": compara com os mesmos DIAS INTEIROS do mês passado, não a mesma hora do relógio (bug real)', () => {
    // "mes_atual" também cresce (mês todo) — deslocar pelos ~1,5 dia decorridos de agosto dá um
    // pedaço do FIM de julho, não "01-02/07 completos". E comparar até a mesma HORA do relógio
    // (em vez de dia inteiro) oscila com 1 pedido de madrugada e diverge do card "Personalizado"
    // — por isso o fix usa dia inteiro (00:00→23:59:59.999), não hora exata. Datas sem "Z" (hora
    // local), como no resto do arquivo, porque a resolução do fix opera em hora local.
    const desde = new Date(2026, 7, 1, 0, 0, 0).toISOString(); // 01/08 00:00 local
    const ate = new Date(2026, 7, 2, 15, 0, 0).toISOString(); // 02/08 15:00 local (~1,625 dia decorrido)
    const j = { desde, ate };

    const semTipo = janelaAnterior(j); // comportamento genérico (bug): desloca pela duração decorrida
    const durMs = Date.parse(ate) - Date.parse(desde);
    expect(semTipo).toEqual({ desde: new Date(Date.parse(desde) - durMs).toISOString(), ate: desde });

    const a = janelaAnterior(j, { tipo: 'mes_atual' }); // fix: mesmos dias inteiros do mês anterior
    expect(a).toEqual({
      desde: new Date(2026, 6, 1, 0, 0, 0).toISOString(), // 01/07 00:00 local
      ate: new Date(2026, 6, 2, 23, 59, 59, 999).toISOString(), // 02/07 23:59:59.999 local — dia inteiro
    });
  });

  it('"mes_atual": clampa dia 31 quando o mês anterior é mais curto (31/mar → 28/fev, sem rollover pra março)', () => {
    const j = {
      desde: new Date(2026, 2, 1, 0, 0, 0).toISOString(), // 01/03 00:00 local
      ate: new Date(2026, 2, 31, 9, 0, 0).toISOString(), // 31/03 09:00 local
    };
    const a = janelaAnterior(j, { tipo: 'mes_atual' });
    expect(a).toEqual({
      desde: new Date(2026, 1, 1, 0, 0, 0).toISOString(), // 01/02 00:00 local
      ate: new Date(2026, 1, 28, 23, 59, 59, 999).toISOString(), // 28/02 23:59:59.999 (2026 não é bissexto)
    });
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
