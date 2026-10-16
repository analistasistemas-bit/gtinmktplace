import { describe, it, expect } from 'vitest';
import { idLinhaNota, podeDesfazer } from '../secao-notas-compra';

const n = (status: 'importada' | 'desfeita' | 'cancelada') => ({ id: '1', chave: 'x', numero: 1, emitenteNome: 'F',
  emitidaEm: '2026-10-13', valorTotal: 1, status, assinada: true, xmlPath: 'o/x.xml' });

describe('podeDesfazer', () => {
  it('só admin e só nota importada', () => {
    expect(podeDesfazer(n('importada'), true)).toBe(true);
    expect(podeDesfazer(n('importada'), false)).toBe(false);
    expect(podeDesfazer(n('desfeita'), true)).toBe(false);
    expect(podeDesfazer(n('cancelada'), true)).toBe(false);
  });
});

describe('idLinhaNota', () => {
  it('deriva o id da linha da chave', () => {
    expect(idLinhaNota('123')).toBe('nota-compra-123');
  });
});
