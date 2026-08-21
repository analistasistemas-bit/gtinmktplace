import { describe, it, expect } from 'vitest';
import { chaveCacheGtin } from '../cache-chave';

describe('chaveCacheGtin', () => {
  it('monta o termo com a versão vigente v5', () => {
    expect(chaveCacheGtin('7908615000244')).toBe('gtin:v5:7908615000244');
  });

  it('não reutiliza o payload v4 legado sem detalhes de oferta', () => {
    const gtin = '7908615000244';
    const cache = new Map([
      [`gtin:v4:${gtin}`, { ofertas: { ofertas_detalhe: [{ preco: 36, seller_id: 1 }] } }],
    ]);

    expect(cache.get(chaveCacheGtin(gtin))).toBeUndefined();
  });
});
