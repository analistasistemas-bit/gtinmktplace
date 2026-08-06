import { describe, it, expect } from 'vitest';
import { montarMapaCanonico, canonizarItem } from '../anuncio-canonico';

describe('montarMapaCanonico', () => {
  it('mapeia catalog_listing_id → ml_item_id da família (modelo legado)', () => {
    const m = montarMapaCanonico(
      [{ catalog_listing_id: 'MLB_CAT', familias: { ml_item_id: 'MLB_MEU' } }],
      [],
    );
    expect(m).toEqual({ MLB_CAT: 'MLB_MEU' });
  });

  it('aceita familias como array (embed do PostgREST)', () => {
    const m = montarMapaCanonico(
      [{ catalog_listing_id: 'MLB_CAT', familias: [{ ml_item_id: 'MLB_MEU' }] }],
      [],
    );
    expect(m.MLB_CAT).toBe('MLB_MEU');
  });

  it('mapeia o listing do item User Products no próprio item (ADR-0088)', () => {
    const m = montarMapaCanonico([], [{ catalog_listing_id: 'MLB_CAT_UP', item_externo_id: 'MLB_UP' }]);
    expect(m).toEqual({ MLB_CAT_UP: 'MLB_UP' });
  });

  it('descarta dono nulo e auto-referência (não cria ciclo)', () => {
    const m = montarMapaCanonico(
      [{ catalog_listing_id: 'MLB_A', familias: { ml_item_id: null } },
       { catalog_listing_id: 'MLB_B', familias: { ml_item_id: 'MLB_B' } }],
      [{ catalog_listing_id: null, item_externo_id: 'MLB_C' }],
    );
    expect(m).toEqual({});
  });
});

describe('canonizarItem', () => {
  it('devolve o dono quando mapeado, senão o próprio id', () => {
    expect(canonizarItem('MLB_CAT', { MLB_CAT: 'MLB_MEU' })).toBe('MLB_MEU');
    expect(canonizarItem('MLB_X', { MLB_CAT: 'MLB_MEU' })).toBe('MLB_X');
    expect(canonizarItem('MLB_X')).toBe('MLB_X');
  });
});
