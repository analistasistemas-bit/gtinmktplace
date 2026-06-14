import { describe, it, expect } from 'vitest';
import { getConnector } from '../registry.ts';

describe('getConnector', () => {
  it('resolve o conector do Mercado Livre', () => {
    const c = getConnector('mercado_livre');
    expect(c.id).toBe('mercado_livre');
    expect(c.capabilities.variacoes).toBe(true);
    expect(typeof c.criarAnuncio).toBe('function');
  });

  it('lança para canal desconhecido', () => {
    // @ts-expect-error canal inválido em runtime
    expect(() => getConnector('tiktok')).toThrow(/canal não suportado/i);
  });
});
