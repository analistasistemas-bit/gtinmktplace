import { describe, it, expect } from 'vitest';
import { classificarConcorrencia } from '../classificar';

describe('classificarConcorrencia', () => {
  it('0 vendedores → sem', () => {
    expect(classificarConcorrencia(0)).toBe('sem');
  });
  it('1 a 5 → moderada', () => {
    expect(classificarConcorrencia(1)).toBe('moderada');
    expect(classificarConcorrencia(5)).toBe('moderada');
  });
  it('6 ou mais → alta', () => {
    expect(classificarConcorrencia(6)).toBe('alta');
    expect(classificarConcorrencia(50)).toBe('alta');
  });
});
