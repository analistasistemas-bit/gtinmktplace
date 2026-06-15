import { describe, it, expect } from 'vitest';
import { precisaRenovar } from '../../ml/refresh-decisao';

// token.ts reusa `precisaRenovar` (ADR-0012) para a decisão de refresh. O fluxo
// de I/O (RPC + Redis + fetch) é coberto por integração/sandbox; aqui validamos
// a decisão pura que governa o getValidAccessToken da Shopee.
const BUFFER_MS = 5 * 60 * 1000;

describe('decisão de refresh do token Shopee (precisaRenovar)', () => {
  it('token válido bem no futuro → não renova', () => {
    const agora = Date.now();
    expect(precisaRenovar(agora + 60 * 60 * 1000, agora, BUFFER_MS)).toBe(false);
  });

  it('token dentro do buffer de 5 min → renova', () => {
    const agora = Date.now();
    expect(precisaRenovar(agora + 2 * 60 * 1000, agora, BUFFER_MS)).toBe(true);
  });

  it('token já expirado → renova', () => {
    const agora = Date.now();
    expect(precisaRenovar(agora - 1000, agora, BUFFER_MS)).toBe(true);
  });
});
