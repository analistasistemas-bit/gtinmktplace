import { describe, it, expect } from 'vitest';
import { montarMapaCanonico, canonizarItem } from '../anuncio-canonico';

describe('montarMapaCanonico', () => {
  it('mapeia catalog_listing_id → ml_item_id da família (modelo legado)', () => {
    const m = montarMapaCanonico(
      [{ catalog_listing_id: 'MLB_CAT', familias: { ml_item_id: 'MLB_MEU' } }],
      [],
    );
    expect(m.listings).toEqual({ MLB_CAT: 'MLB_MEU' });
  });

  it('aceita familias como array (embed do PostgREST)', () => {
    const m = montarMapaCanonico(
      [{ catalog_listing_id: 'MLB_CAT', familias: [{ ml_item_id: 'MLB_MEU' }] }],
      [],
    );
    expect(m.listings.MLB_CAT).toBe('MLB_MEU');
  });

  it('mapeia o listing do item User Products no próprio item (ADR-0088)', () => {
    const m = montarMapaCanonico([], [{ catalog_listing_id: 'MLB_CAT_UP', item_externo_id: 'MLB_UP' }]);
    expect(m.listings).toEqual({ MLB_CAT_UP: 'MLB_UP' });
  });

  it('descarta dono nulo e auto-referência (não cria ciclo)', () => {
    const m = montarMapaCanonico(
      [{ catalog_listing_id: 'MLB_A', familias: { ml_item_id: null } },
       { catalog_listing_id: 'MLB_B', familias: { ml_item_id: 'MLB_B' } }],
      [{ catalog_listing_id: null, item_externo_id: 'MLB_C' }],
    );
    expect(m.listings).toEqual({});
  });

  it('mapeia GTIN → anúncio dono e normaliza o GTIN', () => {
    const m = montarMapaCanonico([], [], [{ gtin: ' 07891234567895 ', familias: { ml_item_id: 'MLB_DONO' } }]);
    expect(m.gtins?.['7891234567895']).toBe('MLB_DONO');
  });

  it('DESCARTA GTIN que aponta para mais de um anúncio (kit x unidade, split de faixa — ADR-0045)', () => {
    const m = montarMapaCanonico([], [], [
      { gtin: '789', familias: { ml_item_id: 'MLB_UNIDADE' } },
      { gtin: '789', familias: { ml_item_id: 'MLB_KIT' } },
    ]);
    expect(m.gtins?.['789']).toBeUndefined();
  });

  it('registra os anúncios conhecidos (famílias e anúncios externos)', () => {
    const m = montarMapaCanonico([], [], [], ['MLB_FAM', null, 'MLB_EXT']);
    expect(m.conhecidos?.has('MLB_FAM')).toBe(true);
    expect(m.conhecidos?.has('MLB_EXT')).toBe(true);
    expect(m.conhecidos?.size).toBe(2);
  });
});

describe('canonizarItem', () => {
  const vazio = { listings: {}, gtins: {}, conhecidos: new Set<string>() };

  it('devolve o dono quando mapeado, senão o próprio id', () => {
    const m = { ...vazio, listings: { MLB_CAT: 'MLB_MEU' } };
    expect(canonizarItem('MLB_CAT', m)).toBe('MLB_MEU');
    expect(canonizarItem('MLB_X', m)).toBe('MLB_X');
    expect(canonizarItem('MLB_X')).toBe('MLB_X');
  });

  it('funde o anúncio irmão não vinculado no dono do GTIN', () => {
    const m = { ...vazio, gtins: { '789': 'MLB_DONO' }, conhecidos: new Set(['MLB_DONO']) };
    expect(canonizarItem('MLB_IRMAO', m, '789')).toBe('MLB_DONO');
  });

  it('não redireciona anúncio que o app já lista como próprio', () => {
    const m = { ...vazio, gtins: { '789': 'MLB_DONO' }, conhecidos: new Set(['MLB_DONO', 'MLB_OUTRO']) };
    expect(canonizarItem('MLB_OUTRO', m, '789')).toBe('MLB_OUTRO');
  });

  it('sem ean informado, mantém o comportamento anterior (foto/cor não mudam)', () => {
    const m = { ...vazio, gtins: { '789': 'MLB_DONO' } };
    expect(canonizarItem('MLB_IRMAO', m)).toBe('MLB_IRMAO');
  });

  it('GTIN ausente do mapa (ambíguo ou não cadastrado) não redireciona', () => {
    const m = { ...vazio, gtins: {} };
    expect(canonizarItem('MLB_IRMAO', m, '789')).toBe('MLB_IRMAO');
  });

  it('o vínculo explícito de catálogo tem precedência sobre o GTIN', () => {
    const m = { listings: { MLB_CAT: 'MLB_DONO_CAT' }, gtins: { '789': 'MLB_DONO_GTIN' }, conhecidos: new Set<string>() };
    expect(canonizarItem('MLB_CAT', m, '789')).toBe('MLB_DONO_CAT');
  });
});
