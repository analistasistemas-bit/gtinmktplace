import { describe, it, expect, vi } from 'vitest';
import { resolverJanela, periodoFromParams, periodoToParams } from '@/lib/metricas';

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn() } } }));

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
});

describe('periodo <-> params', () => {
  const mk = (o: Record<string, string>) => (k: string) => o[k] ?? null;

  it('preset ida e volta', () => {
    expect(periodoToParams({ tipo: 'preset', dias: 7 })).toEqual({ dias: '7' });
    expect(periodoFromParams(mk({ dias: '7' }))).toEqual({ tipo: 'preset', dias: 7 });
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
