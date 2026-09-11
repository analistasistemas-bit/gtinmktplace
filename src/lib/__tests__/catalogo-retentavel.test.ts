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

  // Desde 2026-09-11: `pendente` (ML ainda computando) e `sem_produto` (ML libera o opt-in, mas a
  // ficha não foi achada) são retentáveis. Ficarem de fora os tornava terminais — o Centrum passou
  // um mês em `sem_produto` com o vínculo já ativo no ML, e só saiu dali por SQL.
  it('pendente → true (ML ainda computando a elegibilidade)', () => {
    expect(variacaoCatalogoRetentavel({
      catalog_status: 'pendente',
      catalog_listing_id: null,
      ml_variation_id: 'v1',
    })).toBe(true);
  });

  it('sem_produto → true (a ficha pode nascer a qualquer momento)', () => {
    expect(variacaoCatalogoRetentavel({
      catalog_status: 'sem_produto',
      catalog_listing_id: null,
      ml_variation_id: 'v1',
    })).toBe(true);
  });

  it('sem_produto JÁ vinculado → false (listing id manda, não o status)', () => {
    expect(variacaoCatalogoRetentavel({
      catalog_status: 'sem_produto',
      catalog_listing_id: 'MLB7391084566',
      ml_variation_id: 'v1',
    })).toBe(false);
  });

  it('ficha_divergente → false (fica fora por escopo; trava do ADR-0021)', () => {
    expect(variacaoCatalogoRetentavel({
      catalog_status: 'ficha_divergente',
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
      [{ catalog_status: 'vinculado', catalog_listing_id: 'MLB9', ml_variation_id: 'a' }],
      [{ item_externo_id: 'MLB1', catalog_listing_id: null, catalog_status: 'nao_elegivel' }],
    )).toBe(true);
  });

  it('nenhum retentável → false', () => {
    expect(familiaTemCatalogoRetentavel([
      { catalog_status: 'ficha_divergente', catalog_listing_id: null, ml_variation_id: 'a' },
    ])).toBe(false);
  });

  it('família toda em sem_produto → true (era o caso do Centrum, antes invisível)', () => {
    expect(familiaTemCatalogoRetentavel([
      { catalog_status: 'sem_produto', catalog_listing_id: null, ml_variation_id: 'MLB5042154755' },
    ])).toBe(true);
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

  it('espelho só pendente → true (transitório, não terminal)', () => {
    expect(catalogStatusRetentavelEmEspelho({
      SKU1: { catalog_status: 'pendente', variation_id: 'v1', catalog_listing_id: null },
    })).toBe(true);
  });

  it('espelho em sem_produto → true', () => {
    expect(catalogStatusRetentavelEmEspelho({
      '00000033': { catalog_status: 'sem_produto', variation_id: 'MLB5042154755', catalog_listing_id: null },
    })).toBe(true);
  });

  it('espelho em ficha_divergente → false (fora do escopo do botão)', () => {
    expect(catalogStatusRetentavelEmEspelho({
      SKU1: { catalog_status: 'ficha_divergente', variation_id: 'v1', catalog_listing_id: null },
    })).toBe(false);
  });

  it('null → false', () => {
    expect(catalogStatusRetentavelEmEspelho(null)).toBe(false);
  });
});
