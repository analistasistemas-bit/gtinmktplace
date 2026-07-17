import { describe, it, expect } from 'vitest';
import { extrairMetragem, garantirMetragemTitulo } from '../titulo';

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

describe('metragem decimal com vírgula (bug lote #65 — família 02851903, "T-007")', () => {
  it('extrairMetragem lê o número decimal inteiro, não só a cauda após a vírgula', () => {
    expect(extrairMetragem('BORDADO INGLES BUFALO T-007 13,71MT 5CM LARGURA')).toBe('13,71MT');
  });

  it('não injeta fragmento fabricado ("71MT") quando a IA arredondou a metragem decimal no título (bug real do lote #65)', () => {
    const t = garantirMetragemTitulo(
      'BORDADO INGLES BUFALO T-007 13,7MT | 5CM LARGURA',
      'BORDADO INGLES BUFALO T-007 13,71MT 5CM LARGURA',
    );
    // "71MT" isolado (não como cauda de "13,71MT") é o fragmento fabricado do bug.
    expect(t).not.toMatch(/(?:^|\s)71MT(?:\s|$)/);
    expect(t).toContain('13,71MT');
  });
});
