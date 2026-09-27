import { describe, expect, it } from 'vitest';
import { cicloDoDisparo } from '../passo.ts';

describe('cicloDoDisparo', () => {
  it('sem desde/ate → backfill + dia BRT', () => {
    // 02:00 UTC de 27/09 = 23:00 BRT de 26/09
    expect(cicloDoDisparo({}, new Date('2026-09-27T02:00:00Z'))).toEqual({ job: 'backfill', ciclo: '2026-09-26' });
    expect(cicloDoDisparo({}, new Date('2026-09-27T06:30:00Z'))).toEqual({ job: 'backfill', ciclo: '2026-09-27' });
  });

  it('desde+ate → backfill-recuperacao, ciclo = a janela, independente do relógio', () => {
    const body = { desde: '2026-09-10T00:00:00Z', ate: '2026-09-27T15:00:00Z' };
    const a = cicloDoDisparo(body, new Date('2026-09-27T15:00:01Z'));
    const b = cicloDoDisparo(body, new Date('2026-09-27T15:30:00Z'));
    expect(a).toEqual({ job: 'backfill-recuperacao', ciclo: '2026-09-10T00:00:00Z_2026-09-27T15:00:00Z' });
    expect(b).toEqual(a);
  });
});
