import { describe, it, expect } from 'vitest';
import { normalizarAliquotaInterna } from '../queries';

describe('normalizarAliquotaInterna (ADR-0112)', () => {
  it('aceita UF e percentual juntos, normalizando a UF para maiúsculas', () => {
    expect(normalizarAliquotaInterna(' pe ', 1)).toEqual({ ufEmpresa: 'PE', internaPct: 1 });
  });

  it('aceita os dois vazios (parâmetro desligado)', () => {
    expect(normalizarAliquotaInterna(null, null)).toEqual({ ufEmpresa: null, internaPct: null });
    expect(normalizarAliquotaInterna('', null)).toEqual({ ufEmpresa: null, internaPct: null });
  });

  it('recusa UF sem percentual', () => {
    expect(() => normalizarAliquotaInterna('PE', null)).toThrow(/UF e percentual/);
  });

  it('recusa percentual sem UF', () => {
    expect(() => normalizarAliquotaInterna(null, 1)).toThrow(/UF e percentual/);
  });

  it('recusa UF fora do formato de 2 letras', () => {
    expect(() => normalizarAliquotaInterna('PERNAMBUCO', 1)).toThrow(/UF/);
  });

  it('recusa percentual fora da faixa 0–100', () => {
    expect(() => normalizarAliquotaInterna('PE', 101)).toThrow(/percentual/);
  });
});
