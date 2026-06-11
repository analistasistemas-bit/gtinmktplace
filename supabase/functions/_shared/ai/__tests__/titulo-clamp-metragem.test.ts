import { describe, it, expect } from 'vitest';
import { garantirMetragemTitulo } from '../titulo';

describe('garantirMetragemTitulo — clampa mesmo quando a metragem já está no título', () => {
  it('título >60 com a metragem já presente é cortado para <=60 preservando a metragem (bug lote #27)', () => {
    const t = garantirMetragemTitulo(
      'FITA CETIM BUFALO N.1 10MT | 100% POLIÉSTER | BRILHO ACETINADO',
      'FITA CETIM BUFALO N.1 7MM CORES 10MT',
    );
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).toContain('10MT');
  });
});
