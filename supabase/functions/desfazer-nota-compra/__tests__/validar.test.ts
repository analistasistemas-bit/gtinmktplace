import { describe, it, expect } from 'vitest';
import { validarDesfazer, autorizarDesfazer } from '../validar';

describe('autorizarDesfazer', () => {
  it('só admin; suporte full (isAdmin=false) e membro comum recusam', () => {
    expect(autorizarDesfazer({ isAdmin: true, support: null })).toBeNull();
    expect(autorizarDesfazer({ isAdmin: false, support: null })).toMatch(/administrador/);
    expect(autorizarDesfazer({ isAdmin: false, support: { access: 'full' } })).toMatch(/administrador/);
  });
});

describe('validarDesfazer', () => {
  it('exige notaId uuid e status válido', () => {
    expect(validarDesfazer({ notaId: '00000000-0000-0000-0000-000000000001', status: 'cancelada' }).ok).toBe(true);
    expect(validarDesfazer({ notaId: 'x', status: 'cancelada' }).ok).toBe(false);
    expect(validarDesfazer({ notaId: '00000000-0000-0000-0000-000000000001', status: 'apagada' }).ok).toBe(false);
    expect(validarDesfazer(null).ok).toBe(false);
  });
});
