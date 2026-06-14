import { describe, it, expect } from 'vitest';
import { montarAnuncioExterno, mesclarVariacoesExternas } from '../espelhar';

const FAMILIA = {
  user_id: 'u1',
  codigo_pai: '00445916',
  ml_item_id: 'MLB123',
  ml_permalink: 'https://ml/MLB123',
  publicado_em: '2026-06-14T00:00:00Z',
};

describe('montarAnuncioExterno', () => {
  it('monta a row canônica do canal mercado_livre', () => {
    const row = montarAnuncioExterno(FAMILIA, []);
    expect(row.canal).toBe('mercado_livre');
    expect(row.user_id).toBe('u1');
    expect(row.codigo_pai).toBe('00445916');
    expect(row.item_externo_id).toBe('MLB123');
    expect(row.permalink).toBe('https://ml/MLB123');
    expect(row.status).toBe('publicado');
    expect(row.publicado_em).toBe('2026-06-14T00:00:00Z');
    expect(row.variacoes_externas).toEqual({});
  });

  it('inclui no mapa só variações casadas (com ml_variation_id)', () => {
    const row = montarAnuncioExterno(FAMILIA, [
      { codigo: 'A', ml_variation_id: 'v-a' },
      { codigo: 'B', ml_variation_id: null },
    ]);
    expect(row.variacoes_externas).toEqual({ A: { variation_id: 'v-a' } });
  });

  it('inclui catalog_* só quando presente e ≠ pendente', () => {
    const row = montarAnuncioExterno(FAMILIA, [
      { codigo: 'A', ml_variation_id: 'v-a', catalog_listing_id: 'MLB9', catalog_product_id: 'MLB1', catalog_status: 'vinculado' },
      { codigo: 'B', ml_variation_id: 'v-b', catalog_status: 'pendente' },
    ]);
    expect(row.variacoes_externas).toEqual({
      A: { variation_id: 'v-a', catalog_product_id: 'MLB1', catalog_listing_id: 'MLB9', catalog_status: 'vinculado' },
      B: { variation_id: 'v-b' },
    });
  });

  it('item_externo_id null quando família ainda sem ml_item_id', () => {
    const row = montarAnuncioExterno({ ...FAMILIA, ml_item_id: null, ml_permalink: null }, []);
    expect(row.item_externo_id).toBeNull();
    expect(row.permalink).toBeNull();
  });
});

describe('mesclarVariacoesExternas', () => {
  it('reposição parcial preserva as cores ausentes (não encolhe o mapa)', () => {
    const existente = {
      A: { variation_id: 'v-a' },
      B: { variation_id: 'v-b', catalog_status: 'vinculado', catalog_listing_id: 'MLB9' },
      C: { variation_id: 'v-c' },
    };
    const novo = { A: { variation_id: 'v-a' } }; // lote de reposição só com a cor A
    expect(mesclarVariacoesExternas(existente, novo)).toEqual({
      A: { variation_id: 'v-a' },
      B: { variation_id: 'v-b', catalog_status: 'vinculado', catalog_listing_id: 'MLB9' },
      C: { variation_id: 'v-c' },
    });
  });

  it('o novo vence por código (atualiza catalog state)', () => {
    const existente = { A: { variation_id: 'v-a' } };
    const novo = { A: { variation_id: 'v-a', catalog_status: 'vinculado', catalog_listing_id: 'MLB9' } };
    expect(mesclarVariacoesExternas(existente, novo)).toEqual({
      A: { variation_id: 'v-a', catalog_status: 'vinculado', catalog_listing_id: 'MLB9' },
    });
  });

  it('mapa existente nulo → retorna só o novo', () => {
    expect(mesclarVariacoesExternas(null, { A: { variation_id: 'v-a' } })).toEqual({ A: { variation_id: 'v-a' } });
  });
});
