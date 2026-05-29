import { describe, it, expect } from 'vitest';
import { precisaRenovar } from '../refresh-decisao';

const BUFFER = 5 * 60 * 1000; // 5 min

describe('precisaRenovar', () => {
  it('NÃO renova quando falta bem mais que o buffer', () => {
    const agora = 1_000_000;
    const expira = agora + 60 * 60 * 1000; // +1h
    expect(precisaRenovar(expira, agora, BUFFER)).toBe(false);
  });

  it('renova quando falta menos que o buffer', () => {
    const agora = 1_000_000;
    const expira = agora + 2 * 60 * 1000; // +2 min
    expect(precisaRenovar(expira, agora, BUFFER)).toBe(true);
  });

  it('renova quando já expirou', () => {
    const agora = 1_000_000;
    const expira = agora - 1000;
    expect(precisaRenovar(expira, agora, BUFFER)).toBe(true);
  });

  it('renova exatamente no limite do buffer', () => {
    const agora = 1_000_000;
    const expira = agora + BUFFER;
    expect(precisaRenovar(expira, agora, BUFFER)).toBe(true);
  });
});
