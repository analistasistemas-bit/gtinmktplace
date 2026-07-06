import { describe, it, expect } from 'vitest';
import { deveMostrarSeletorCanais, deveMostrarChipCanal } from '@/lib/canais-ui';

describe('deveMostrarSeletorCanais', () => {
  it('1 conexão (hoje: só ML) → não mostra (zero mudança visual)', () => {
    expect(deveMostrarSeletorCanais(1)).toBe(false);
  });
  it('0 conexões → não mostra', () => {
    expect(deveMostrarSeletorCanais(0)).toBe(false);
  });
  it('2+ conexões → mostra', () => {
    expect(deveMostrarSeletorCanais(2)).toBe(true);
  });
});

describe('deveMostrarChipCanal', () => {
  it('1 canal com anúncios → não mostra', () => {
    expect(deveMostrarChipCanal(1)).toBe(false);
  });
  it('2+ canais com anúncios → mostra', () => {
    expect(deveMostrarChipCanal(2)).toBe(true);
  });
});
