import { describe, it, expect } from 'vitest';
import {
  variacaoCatalogoRetentavel,
  familiaTemCatalogoRetentavel,
  catalogStatusRetentavelEmEspelho,
  itemExternoCatalogoRetentavel,
} from '../catalogo-retentavel';

describe('variacaoCatalogoRetentavel', () => {
  it('erro sem listing → true', () => {
    expect(variacaoCatalogoRetentavel({
      catalog_status: 'erro',
      catalog_listing_id: null,
      ml_variation_id: 'v1',
    })).toBe(true);
  });

  it('nao_elegivel sem listing → true', () => {
    expect(variacaoCatalogoRetentavel({
      catalog_status: 'nao_elegivel',
      catalog_listing_id: null,
      ml_variation_id: 'v1',
    })).toBe(true);
  });

  it('vinculado → false', () => {
    expect(variacaoCatalogoRetentavel({
      catalog_status: 'vinculado',
      catalog_listing_id: 'MLB-CAT',
      ml_variation_id: 'v1',
    })).toBe(false);
  });

  it('pendente → false', () => {
    expect(variacaoCatalogoRetentavel({
      catalog_status: 'pendente',
      catalog_listing_id: null,
      ml_variation_id: 'v1',
    })).toBe(false);
  });

  it('sem ml_variation_id → false', () => {
    expect(variacaoCatalogoRetentavel({
      catalog_status: 'erro',
      catalog_listing_id: null,
      ml_variation_id: null,
    })).toBe(false);
  });

  it('com catalog_listing_id → false', () => {
    expect(variacaoCatalogoRetentavel({
      catalog_status: 'erro',
      catalog_listing_id: 'MLB-CAT',
      ml_variation_id: 'v1',
    })).toBe(false);
  });
});

describe('itemExternoCatalogoRetentavel', () => {
  it('UP erro sem listing → true', () => {
    expect(itemExternoCatalogoRetentavel({
      item_externo_id: 'MLB1',
      catalog_listing_id: null,
      catalog_status: 'erro',
    })).toBe(true);
  });

  it('sem item_externo_id → false', () => {
    expect(itemExternoCatalogoRetentavel({
      item_externo_id: null,
      catalog_listing_id: null,
      catalog_status: 'erro',
    })).toBe(false);
  });
});

describe('familiaTemCatalogoRetentavel', () => {
  it('qualquer variação retentável → true', () => {
    expect(familiaTemCatalogoRetentavel([
      { catalog_status: 'vinculado', catalog_listing_id: 'x', ml_variation_id: 'a' },
      { catalog_status: 'erro', catalog_listing_id: null, ml_variation_id: 'b' },
    ])).toBe(true);
  });

  it('só UP retentável → true', () => {
    expect(familiaTemCatalogoRetentavel(
      [{ catalog_status: 'pendente', catalog_listing_id: null, ml_variation_id: 'a' }],
      [{ item_externo_id: 'MLB1', catalog_listing_id: null, catalog_status: 'nao_elegivel' }],
    )).toBe(true);
  });

  it('nenhum retentável → false', () => {
    expect(familiaTemCatalogoRetentavel([
      { catalog_status: 'pendente', catalog_listing_id: null, ml_variation_id: 'a' },
    ])).toBe(false);
  });
});

describe('catalogStatusRetentavelEmEspelho', () => {
  it('espelho com erro publicado sem listing → true', () => {
    expect(catalogStatusRetentavelEmEspelho({
      SKU1: { catalog_status: 'erro', variation_id: 'v1', catalog_listing_id: null },
      SKU2: { catalog_status: 'vinculado', variation_id: 'v2', catalog_listing_id: 'MLB-CAT' },
    })).toBe(true);
  });

  it('erro com catalog_listing_id → false', () => {
    expect(catalogStatusRetentavelEmEspelho({
      SKU1: { catalog_status: 'erro', variation_id: 'v1', catalog_listing_id: 'MLB-CAT' },
    })).toBe(false);
  });

  it('erro com variation_id sem listing → true', () => {
    expect(catalogStatusRetentavelEmEspelho({
      SKU1: { catalog_status: 'erro', variation_id: 'v1' },
    })).toBe(true);
  });

  it('erro sem variation_id → false', () => {
    expect(catalogStatusRetentavelEmEspelho({
      SKU1: { catalog_status: 'erro', catalog_listing_id: null },
    })).toBe(false);
  });

  it('espelho só pendente → false', () => {
    expect(catalogStatusRetentavelEmEspelho({
      SKU1: { catalog_status: 'pendente', variation_id: 'v1', catalog_listing_id: null },
    })).toBe(false);
  });

  it('null → false', () => {
    expect(catalogStatusRetentavelEmEspelho(null)).toBe(false);
  });
});
