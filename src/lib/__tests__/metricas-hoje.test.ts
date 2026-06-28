import { describe, it, expect } from 'vitest';
import { resolverJanela, periodoToParams, periodoFromParams, type Periodo } from '../metricas';

const get = (params: Record<string, string>) => (k: string) => params[k] ?? null;

describe('período "hoje"', () => {
  it('resolverJanela: desde = meia-noite local, ate = agora (desde <= ate)', () => {
    const j = resolverJanela({ tipo: 'hoje' });
    expect(Date.parse(j.desde)).not.toBeNaN();
    expect(Date.parse(j.ate)).not.toBeNaN();
    expect(Date.parse(j.desde)).toBeLessThanOrEqual(Date.parse(j.ate));
    const d = new Date(j.desde);
    expect([d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  });

  it('periodoToParams serializa hoje como ?periodo=hoje', () => {
    expect(periodoToParams({ tipo: 'hoje' })).toEqual({ periodo: 'hoje' });
  });

  it('periodoFromParams lê ?periodo=hoje', () => {
    expect(periodoFromParams(get({ periodo: 'hoje' }))).toEqual<Periodo>({ tipo: 'hoje' });
  });

  it('periodoFromParams sem periodo cai no default (30 dias)', () => {
    expect(periodoFromParams(get({}))).toEqual<Periodo>({ tipo: 'preset', dias: 30 });
  });
});
