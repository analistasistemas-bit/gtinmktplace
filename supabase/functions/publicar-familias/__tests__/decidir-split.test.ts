import { describe, it, expect } from 'vitest';
import { decidirSplit } from '../decidir-split';

describe('decidirSplit', () => {
  it('uniforme, ≤100 cores, 1 partição → caminho normal (caracterização)', () => {
    expect(decidirSplit({ qtdCores: 3, precosCentavos: [1000, 1000, null], qtdParticoes: 1 })).toBe(false);
    expect(decidirSplit({ qtdCores: 3, precosCentavos: [1000, 1000, 1000], qtdParticoes: 0 })).toBe(false);
  });
  it('>100 cores → split (ADR-0048, comportamento atual)', () => {
    expect(decidirSplit({ qtdCores: 101, precosCentavos: Array(101).fill(1000), qtdParticoes: 0 })).toBe(true);
  });
  it('preços divergentes → split, mesmo com poucas cores (ADR-0078 F2)', () => {
    expect(decidirSplit({ qtdCores: 2, precosCentavos: [1000, 1200], qtdParticoes: 0 })).toBe(true);
  });
  it('produto já particionado (N anúncios no ar) → split sempre, mesmo uniforme', () => {
    expect(decidirSplit({ qtdCores: 5, precosCentavos: [1000, 1000, 1000, 1000, 1000], qtdParticoes: 2 })).toBe(true);
  });
});
