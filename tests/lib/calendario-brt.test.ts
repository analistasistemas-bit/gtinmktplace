import { describe, it, expect } from 'vitest';
import { intervalosBRT } from '@/lib/calendario-brt';

describe('intervalosBRT', () => {
  it('semana começa na segunda 00:00 BRT (03:00Z) e é meio-aberta', () => {
    const iv = intervalosBRT('2026-09-14T03:00:00.000Z', '2026-09-27T02:59:59.999Z', 'semana', new Date('2026-10-01T12:00:00Z'));
    expect(iv.map((i) => [i.inicio, i.fim, i.rotulo])).toEqual([
      ['2026-09-14T03:00:00.000Z', '2026-09-21T03:00:00.000Z', '14/09'],
      ['2026-09-21T03:00:00.000Z', '2026-09-28T03:00:00.000Z', '21/09'],
    ]);
    expect(iv.every((i) => !i.incompleto)).toBe(true);
  });
  it('domingo 23:30 BRT cai na semana que começou na segunda anterior', () => {
    const iv = intervalosBRT('2026-09-21T02:30:00.000Z', '2026-09-21T02:30:00.000Z', 'semana');
    expect(iv[0].inicio).toBe('2026-09-14T03:00:00.000Z');
  });
  it('mês civil em BRT, e o mês corrente é incompleto', () => {
    const iv = intervalosBRT('2026-08-10T12:00:00.000Z', '2026-09-20T12:00:00.000Z', 'mes', new Date('2026-09-20T12:00:00Z'));
    expect(iv.map((i) => [i.inicio, i.rotulo, i.incompleto])).toEqual([
      ['2026-08-01T03:00:00.000Z', 'ago/26', false],
      ['2026-09-01T03:00:00.000Z', 'set/26', true],
    ]);
  });
});
