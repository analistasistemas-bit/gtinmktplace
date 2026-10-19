import { describe, expect, it } from 'vitest';
import { erroCampo } from '@/components/estoque/linha-variacao-form';

// Trava de 2026-10-19 (adendo ADR-0018): cada medida da embalagem é obrigatória por si só.
describe('erroCampo — peso e medidas da embalagem', () => {
  it.each(['pesoGramas', 'alturaCm', 'larguraCm', 'comprimentoCm'] as const)('%s vazio, zero ou negativo trava', (campo) => {
    expect(erroCampo(campo, '')).toMatch(/Obrigatório/);
    expect(erroCampo(campo, '0')).toMatch(/Obrigatório/);
    expect(erroCampo(campo, '-1')).toMatch(/Obrigatório/);
    expect(erroCampo(campo, 'abc')).toBe('Valor inválido.');
    expect(erroCampo(campo, '0,5')).toBeNull();
  });
});
