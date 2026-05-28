import { describe, it, expect } from 'vitest';
import { DICIONARIO_CORES } from '../dicionario';

describe('DICIONARIO_CORES', () => {
  it('tem pelo menos 40 cores canônicas', () => {
    expect(DICIONARIO_CORES.length).toBeGreaterThanOrEqual(40);
  });

  it('toda entrada tem canonica + sinonimos (>=1)', () => {
    for (const cor of DICIONARIO_CORES) {
      expect(cor.canonica).toBeTruthy();
      expect(cor.sinonimos.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('canonicas são únicas', () => {
    const canonicas = DICIONARIO_CORES.map(c => c.canonica);
    expect(new Set(canonicas).size).toBe(canonicas.length);
  });

  it('cores básicas estão presentes', () => {
    const canonicas = DICIONARIO_CORES.map(c => c.canonica);
    expect(canonicas).toContain('Preto');
    expect(canonicas).toContain('Branco');
    expect(canonicas).toContain('Azul Royal');
    expect(canonicas).toContain('Cru');
  });
});
