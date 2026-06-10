import { describe, it, expect } from 'vitest';
import { decidirAcaoCatalogo, montarBodyOptin, indexarEligibility, type EligVar } from '../catalogo';

const READY: EligVar = { id: 1, status: 'READY_FOR_OPTIN', buy_box_eligible: true };
const FAMILY_DIFF: EligVar = { id: 2, status: 'FAMILY_DIFF', buy_box_eligible: false, reason: 'variation_belongs_to_different_family' };
const NOT_ELIGIBLE: EligVar = { id: 3, status: 'NOT_ELIGIBLE', buy_box_eligible: false };

describe('decidirAcaoCatalogo', () => {
  it('já vinculada (catalog_listing_id) → pula, ignora elegibilidade', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: 'MLB999', catalogProductId: 'MLB1' }, READY)).toBe('pula');
  });

  it('elegível + produto casado → optin', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB24436207' }, READY)).toBe('optin');
  });

  it('elegível mas sem produto de catálogo casado → sem_produto', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: null }, READY)).toBe('sem_produto');
  });

  it('FAMILY_DIFF → family_diff (mesmo com produto casado)', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB1' }, FAMILY_DIFF)).toBe('family_diff');
  });

  it('NOT_ELIGIBLE → nao_elegivel', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB1' }, NOT_ELIGIBLE)).toBe('nao_elegivel');
  });

  it('READY mas buy_box_eligible false → nao_elegivel (não arrisca)', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB1' }, { id: 4, status: 'READY_FOR_OPTIN', buy_box_eligible: false })).toBe('nao_elegivel');
  });

  it('sem entrada de elegibilidade (variação ausente) → nao_elegivel', () => {
    expect(decidirAcaoCatalogo({ catalogListingId: null, catalogProductId: 'MLB1' }, undefined)).toBe('nao_elegivel');
  });
});

describe('montarBodyOptin', () => {
  it('monta o body do POST /items/catalog_listings com variation_id numérico', () => {
    expect(montarBodyOptin('MLB6901096672', '203313876609', 'MLB28853753')).toEqual({
      item_id: 'MLB6901096672',
      variation_id: 203313876609,
      catalog_product_id: 'MLB28853753',
    });
  });
});

describe('indexarEligibility', () => {
  it('indexa variações por variation_id (string)', () => {
    const m = indexarEligibility({ variations: [READY, FAMILY_DIFF] });
    expect(m.get('1')?.status).toBe('READY_FOR_OPTIN');
    expect(m.get('2')?.status).toBe('FAMILY_DIFF');
    expect(m.size).toBe(2);
  });

  it('corpo nulo/sem variations → mapa vazio', () => {
    expect(indexarEligibility(null).size).toBe(0);
    expect(indexarEligibility({}).size).toBe(0);
    expect(indexarEligibility({ status: 'READY_FOR_OPTIN' }).size).toBe(0);
  });
});
