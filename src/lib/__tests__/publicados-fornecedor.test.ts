import { describe, it, expect } from 'vitest';
import { primeiroNome } from '../publicados';

describe('primeiroNome', () => {
  it('extrai a primeira palavra do fornecedor', () => {
    expect(primeiroNome('DETALLIA FITAS TEXTEIS LTDA')).toBe('DETALLIA');
  });

  it('mantém nome de palavra única', () => {
    expect(primeiroNome('DETALLIA')).toBe('DETALLIA');
  });

  it('ignora espaços extras', () => {
    expect(primeiroNome('  DETALLIA   FITAS  ')).toBe('DETALLIA');
  });

  it('retorna null para vazio/nulo', () => {
    expect(primeiroNome(null)).toBeNull();
    expect(primeiroNome(undefined)).toBeNull();
    expect(primeiroNome('   ')).toBeNull();
  });
});
