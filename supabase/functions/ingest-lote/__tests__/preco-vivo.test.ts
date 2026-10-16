import { describe, it, expect, vi } from 'vitest';
import { parsePrecosVivos, precoVivoDaVariacao, lerPrecosVivosML } from '../preco-vivo';

const bulk = [
  { status_code: 200, body: { id: 'MLB1', price: 19, variations: [{ id: 111, price: 19 }, { id: 222, price: 21 }] } },
  { status_code: 200, body: { id: 'MLB2', price: 29, variations: [] } },
  { status_code: 404 },
];

describe('parsePrecosVivos', () => {
  it('lê price do item e por variação (id como string); ignora não-200', () => {
    const m = parsePrecosVivos(bulk, ['MLB1', 'MLB2', 'MLB9']);
    expect(m.get('MLB1')).toEqual({ price: 19, porVariacao: new Map([['111', 19], ['222', 21]]) });
    expect(m.get('MLB2')).toEqual({ price: 29, porVariacao: new Map() });
    expect(m.has('MLB9')).toBe(false);
  });
});

describe('precoVivoDaVariacao', () => {
  const vivos = parsePrecosVivos(bulk, ['MLB1', 'MLB2']);
  it('Legacy: preço da própria variação no anúncio', () => {
    expect(precoVivoDaVariacao(vivos, { itemLegacy: 'MLB1', mlVariationId: '222' })).toBe(21);
  });
  it('Legacy: variação fora do anúncio (sem ml_variation_id) não tem preço vivo', () => {
    expect(precoVivoDaVariacao(vivos, { itemLegacy: 'MLB1', mlVariationId: null })).toBeNull();
  });
  it('UP: price do item do SKU', () => {
    expect(precoVivoDaVariacao(vivos, { itemUP: 'MLB2', itemLegacy: 'MLB1', mlVariationId: null })).toBe(29);
  });
  it('item não lido (falha/404) → null (cai no snapshot)', () => {
    expect(precoVivoDaVariacao(vivos, { itemUP: 'MLB9', mlVariationId: null })).toBeNull();
  });
});

describe('lerPrecosVivosML', () => {
  it('blocos de 20 ids e HTTP de erro lança', async () => {
    const ids = Array.from({ length: 21 }, (_, i) => `MLB${i}`);
    const fetchOk = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
    await lerPrecosVivosML('tok', ids, fetchOk as unknown as typeof fetch);
    expect(fetchOk).toHaveBeenCalledTimes(2);
    const fetchErro = vi.fn(async () => new Response('x', { status: 500 }));
    await expect(lerPrecosVivosML('tok', ['MLB1'], fetchErro as unknown as typeof fetch)).rejects.toThrow();
  });
});
