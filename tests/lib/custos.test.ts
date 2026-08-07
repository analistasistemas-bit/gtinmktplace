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

describe('montarCustoResolver — fallback por Código/SKU sem EAN', () => {
  it('casa por código quando item não tem EAN nem variação/anúncio vinculados', () => {
    const mapas = montarMapasCusto([linha({ codigo: '2743647', custo: 26, peso_gramas: 2200 })]);
    const custo = montarCustoResolver(mapas);
    const peso = montarPesoResolver(mapas);

    // Venda vinda do ML com SKU '02743647' (com zero à esquerda) e ean: null
    expect(custo(item({ codigo: '02743647', ean: null }))).toBe(26);
    expect(peso(item({ codigo: '02743647', ean: null }))).toBe(2200);

    // Venda vinda com SKU '2743647' (sem zero à esquerda)
    expect(custo(item({ codigo: '2743647', ean: null }))).toBe(26);
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

describe('montarMapasCusto — tie-break pela linha mais recente (ADR-0108)', () => {
  it('mesma chave em linhas distintas mantém a mais recente, peso acompanha', () => {
    const mapas = montarMapasCusto([
      linha({ ml_variation_id: '7', custo: 30, peso_gramas: 300, atualizado_em: '2026-06-01T00:00:00Z' }),
      linha({ ml_variation_id: '7', custo: 50, peso_gramas: 500, atualizado_em: '2026-07-01T00:00:00Z' }),
      linha({ ml_variation_id: '7', custo: 20, peso_gramas: 200, atualizado_em: '2026-08-01T00:00:00Z' }),
    ]);
    expect(montarCustoResolver(mapas)(item({ variation_id: 7 }))).toBe(20);
    expect(montarPesoResolver(mapas)(item({ variation_id: 7 }))).toBe(200);
  });

  // O caso que motivou a mudança: COLA EM BASTÃO 02841037 existia em 3 famílias (lotes 26, 39 e
  // 78) com TODAS as chaves iguais — ml_item_id, ml_variation_id, gtin e codigo. O custo caiu de
  // 17,1224 para 15,8558, mas o tie-break por maior custo segurava o valor antigo: a venda de
  // 2 unidades exibia R$ 34,24 em vez de R$ 31,71.
  it('custo que CAIU passa a valer — era o bug do "maior custo"', () => {
    const antiga = { gtin: '7453000325513', codigo: '02841037', familias: { ml_item_id: 'MLB6943015034' } };
    const mapas = montarMapasCusto([
      linha({ ...antiga, ml_variation_id: '203734189745', custo: 17.1224, atualizado_em: '2026-07-05T18:08:06Z' }),
      linha({ ...antiga, ml_variation_id: '203734189745', custo: 17.1224, atualizado_em: '2026-07-05T18:08:06Z' }),
      linha({ ...antiga, ml_variation_id: '203734189745', custo: 15.8558, atualizado_em: '2026-08-07T17:33:17Z' }),
    ]);
    const custo = montarCustoResolver(mapas);
    // Resolve igual por qualquer chave da cadeia — nenhuma delas desambigua sozinha.
    expect(custo(item({ variation_id: 203734189745 }))).toBe(15.8558);
    expect(custo(item({ ml_item_id: 'MLB6943015034' }))).toBe(15.8558);
    expect(custo(item({ ean: '7453000325513' }))).toBe(15.8558);
    expect(custo(item({ codigo: '02841037' }))).toBe(15.8558);
  });

  it('custo que SUBIU também passa a valer (o tie-break não tem lado)', () => {
    const mapas = montarMapasCusto([
      linha({ ml_variation_id: '9', custo: 10, atualizado_em: '2026-06-01T00:00:00Z' }),
      linha({ ml_variation_id: '9', custo: 25, atualizado_em: '2026-08-01T00:00:00Z' }),
    ]);
    expect(montarCustoResolver(mapas)(item({ variation_id: 9 }))).toBe(25);
  });

  it('sem atualizado_em (ou empatado) a primeira linha prevalece, sem quebrar', () => {
    const mapas = montarMapasCusto([
      linha({ ml_variation_id: '10', custo: 11 }),
      linha({ ml_variation_id: '10', custo: 22 }),
    ]);
    expect(montarCustoResolver(mapas)(item({ variation_id: 10 }))).toBe(11);
  });

  it('linha mais recente com data inválida não derruba a válida', () => {
    const mapas = montarMapasCusto([
      linha({ ml_variation_id: '11', custo: 33, atualizado_em: '2026-08-01T00:00:00Z' }),
      linha({ ml_variation_id: '11', custo: 44, atualizado_em: 'lixo' }),
    ]);
    expect(montarCustoResolver(mapas)(item({ variation_id: 11 }))).toBe(33);
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
