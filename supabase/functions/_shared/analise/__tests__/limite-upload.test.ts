import { describe, it, expect } from 'vitest';
import { excedeLimiteBase64, MAX_ARQUIVO_BASE64_CHARS } from '../limite-upload';

// F6 (CLAUDE-SECURITY-20260822-113640): um payload base64 pequeno pode declarar tamanho
// descomprimido arbitrário no header ZIP; rejeitar acima de um teto ANTES de decodificar/parsear.
describe('excedeLimiteBase64', () => {
  it('aceita payload dentro do limite', () => {
    expect(excedeLimiteBase64('a'.repeat(1000), 2000)).toBe(false);
  });
  it('rejeita payload acima do limite', () => {
    expect(excedeLimiteBase64('a'.repeat(2001), 2000)).toBe(true);
  });
  it('usa o teto padrão quando nenhum é passado', () => {
    expect(excedeLimiteBase64('a'.repeat(MAX_ARQUIVO_BASE64_CHARS + 1))).toBe(true);
    expect(excedeLimiteBase64('a'.repeat(MAX_ARQUIVO_BASE64_CHARS))).toBe(false);
  });
});
