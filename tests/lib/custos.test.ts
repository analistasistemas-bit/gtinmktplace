import { describe, it, expect } from 'vitest';
import { montarMapasCusto, montarCustoResolver, montarPesoResolver } from '@/lib/custos';
import type { VendaItem } from '@/lib/faturamento';

/** Linha de `variacoes` como chega do supabase (familias!inner devolve objeto único). */
function linha(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { custo: 10, peso_gramas: 100, ml_variation_id: null, gtin: null, familias: { ml_item_id: null }, ...over };
}

/** Item de venda mínimo — resolverProduto só lê variation_id, ml_item_id e ean. */
function item(over: Partial<VendaItem> = {}): VendaItem {
  return {
    id: 'it', ml_item_id: null, variation_id: null, titulo: null, codigo: null,
    cor: null, ean: null, quantity: 1, unit_price: 0, sale_fee: 0, is_publiai: true, ...over,
  };
}

describe('montarCustoResolver — precedência da cadeia variação → anúncio → GTIN', () => {
  // Cada mapa montado de uma linha distinta, com custos distintos, para distinguir qual casou.
  const mapas = montarMapasCusto([
    linha({ ml_variation_id: '12345', custo: 100, peso_gramas: 50 }),
    linha({ familias: { ml_item_id: 'MLB1' }, custo: 200, peso_gramas: 60 }),
    linha({ gtin: '7891', custo: 300, peso_gramas: 70 }),
  ]);

  it('item com variation_id casado resolve por porVariacao mesmo havendo item/gtin', () => {
    const custo = montarCustoResolver(mapas);
    expect(custo(item({ variation_id: 12345, ml_item_id: 'MLB1', ean: '7891' }))).toBe(100);
  });

  it('sem match de variação cai para porItem (anúncio)', () => {
    const custo = montarCustoResolver(mapas);
    expect(custo(item({ variation_id: 999, ml_item_id: 'MLB1', ean: '7891' }))).toBe(200);
  });

  it('sem variação nem item cai para porGtin', () => {
    const custo = montarCustoResolver(mapas);
    expect(custo(item({ ml_item_id: 'ZZZ', ean: '7891' }))).toBe(300);
  });

  it('nenhum match → null', () => {
    const custo = montarCustoResolver(mapas);
    expect(custo(item({ variation_id: 1, ml_item_id: 'ZZZ', ean: '0000' }))).toBeNull();
  });

  it('mapas undefined → null', () => {
    expect(montarCustoResolver(undefined)(item({ ml_item_id: 'MLB1' }))).toBeNull();
  });
});

describe('montarCustoResolver — normalização de GTIN', () => {
  it('casa GTIN com zeros à esquerda contra a chave normalizada', () => {
    const mapas = montarMapasCusto([linha({ gtin: '0007891', custo: 42 })]);
    const custo = montarCustoResolver(mapas);
    expect(custo(item({ ean: '7891' }))).toBe(42);
    expect(custo(item({ ean: '0007891' }))).toBe(42);
  });
});

describe('montarPesoResolver', () => {
  const mapas = montarMapasCusto([
    linha({ ml_variation_id: '1', custo: 10, peso_gramas: 250 }),
    linha({ ml_variation_id: '2', custo: 10, peso_gramas: 0 }),
  ]);

  it('peso > 0 → o valor', () => {
    expect(montarPesoResolver(mapas)(item({ variation_id: 1 }))).toBe(250);
  });

  it('peso 0 → null', () => {
    expect(montarPesoResolver(mapas)(item({ variation_id: 2 }))).toBeNull();
  });

  it('sem match → null', () => {
    expect(montarPesoResolver(mapas)(item({ variation_id: 9 }))).toBeNull();
  });
});

describe('montarMapasCusto — tie-break por maior custo', () => {
  it('mesma chave em linhas distintas mantém a de maior custo, peso acompanha', () => {
    const mapas = montarMapasCusto([
      linha({ ml_variation_id: '7', custo: 30, peso_gramas: 300 }),
      linha({ ml_variation_id: '7', custo: 50, peso_gramas: 500 }),
      linha({ ml_variation_id: '7', custo: 20, peso_gramas: 200 }),
    ]);
    expect(montarCustoResolver(mapas)(item({ variation_id: 7 }))).toBe(50);
    expect(montarPesoResolver(mapas)(item({ variation_id: 7 }))).toBe(500);
  });

  it('linha com custo ≤ 0 ou null é ignorada', () => {
    const mapas = montarMapasCusto([
      linha({ ml_variation_id: '8', custo: 0 }),
      linha({ ml_variation_id: '9', custo: null }),
      linha({ ml_variation_id: '10', custo: -5 }),
    ]);
    expect(montarCustoResolver(mapas)(item({ variation_id: 8 }))).toBeNull();
    expect(montarCustoResolver(mapas)(item({ variation_id: 9 }))).toBeNull();
    expect(montarCustoResolver(mapas)(item({ variation_id: 10 }))).toBeNull();
  });
});
