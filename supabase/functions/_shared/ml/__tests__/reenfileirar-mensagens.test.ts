import { describe, expect, it } from 'vitest';
import { deveReenfileirarMensagens } from '../reenfileirar-mensagens.ts';

describe('deveReenfileirarMensagens', () => {
  const agora = new Date('2026-07-12T12:00:00.000Z').getTime();

  it('sem linha existente: false', () => {
    expect(deveReenfileirarMensagens(null, agora)).toBe(false);
  });

  it('linha já processada: false', () => {
    const existente = { recebido_em: new Date(agora - 10 * 60_000).toISOString(), processado_em: new Date().toISOString() };
    expect(deveReenfileirarMensagens(existente, agora)).toBe(false);
  });

  it('linha não-processada recente (<=2min): false', () => {
    const existente = { recebido_em: new Date(agora - 60_000).toISOString(), processado_em: null };
    expect(deveReenfileirarMensagens(existente, agora)).toBe(false);
  });

  it('linha não-processada antiga (>2min): true', () => {
    const existente = { recebido_em: new Date(agora - 121_000).toISOString(), processado_em: null };
    expect(deveReenfileirarMensagens(existente, agora)).toBe(true);
  });
});
