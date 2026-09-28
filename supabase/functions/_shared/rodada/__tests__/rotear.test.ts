import { describe, expect, it } from 'vitest';
import { rotear } from '../rodada.ts';

const MSG = { modo: 'org', job: 'backfill', org_id: 'org-1', ciclo: '2026-09-27', params: {} };

describe('rotear', () => {
  it('sem assinatura → manual, mesmo com corpo de MsgOrg', () => {
    expect(rotear(false, MSG, true)).toBe('manual');
    expect(rotear(false, {}, false)).toBe('manual');
  });

  it('MsgOrg válida → org, com e sem flag', () => {
    expect(rotear(true, MSG, true)).toBe('org');
    expect(rotear(true, MSG, false)).toBe('org');
  });

  it("modo:'org' malformado → invalida, com e sem flag (nunca cai no disparo/legado)", () => {
    const { org_id: _, ...semOrg } = MSG;
    expect(rotear(true, semOrg, true)).toBe('invalida');
    expect(rotear(true, semOrg, false)).toBe('invalida');
    expect(rotear(true, { ...MSG, job: 'inexistente' }, false)).toBe('invalida');
  });

  it('corpo do schedule → disparo com flag, legado sem', () => {
    expect(rotear(true, { dias: 30 }, true)).toBe('disparo');
    expect(rotear(true, { dias: 30 }, false)).toBe('legado');
    expect(rotear(true, {}, false)).toBe('legado');
    expect(rotear(true, null, true)).toBe('disparo');
  });
});
