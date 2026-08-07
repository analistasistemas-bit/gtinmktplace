import { describe, it, expect } from 'vitest';
import { montarMapasCustoVigente, resolverCustoVigente, type LinhaCusto, type ItemParaCusto } from '../custo-vigente.ts';

/** Linha de `variacoes` como o catálogo do backend a entrega. */
function linha(over: Partial<LinhaCusto> = {}): LinhaCusto {
  return {
    custo: 10, atualizado_em: '2026-07-01T00:00:00Z',
    ml_variation_id: null, ml_item_id: null, gtin: null, codigo: null, ...over,
  };
}

function item(over: Partial<ItemParaCusto> = {}): ItemParaCusto {
  return { variation_id: null, ml_item_id: null, ean: null, codigo: null, ...over };
}

describe('resolverCustoVigente — precedência da cadeia variação → anúncio → GTIN → código', () => {
  // Custos distintos por chave para distinguir qual delas casou.
  const m = montarMapasCustoVigente([
    linha({ ml_variation_id: '12345', custo: 100 }),
    linha({ ml_item_id: 'MLB1', custo: 200 }),
    linha({ gtin: '7891', custo: 300 }),
    linha({ codigo: '00099', custo: 400 }),
  ]);

  it('variação casada vence item, gtin e código', () => {
    expect(resolverCustoVigente(m, item({ variation_id: 12345, ml_item_id: 'MLB1', ean: '7891', codigo: '00099' }))).toBe(100);
  });

  it('sem variação cai para o anúncio', () => {
    expect(resolverCustoVigente(m, item({ variation_id: 999, ml_item_id: 'MLB1', ean: '7891' }))).toBe(200);
  });

  it('sem variação nem anúncio cai para o GTIN', () => {
    expect(resolverCustoVigente(m, item({ ml_item_id: 'ZZZ', ean: '7891' }))).toBe(300);
  });

  it('por último, o código', () => {
    expect(resolverCustoVigente(m, item({ ean: '000', codigo: '00099' }))).toBe(400);
  });

  it('nenhum match → null', () => {
    expect(resolverCustoVigente(m, item({ variation_id: 1, ml_item_id: 'X', ean: '2', codigo: '3' }))).toBeNull();
  });
});

describe('montarMapasCustoVigente — tie-break pela linha mais recente (ADR-0108)', () => {
  // Caso real: COLA EM BASTÃO 02841037 em 3 famílias com TODAS as chaves iguais. O custo caiu de
  // 17,1224 para 15,8558 — vence o mais recente, por qualquer chave da cadeia.
  it('custo que caiu vale, resolvido por qualquer chave', () => {
    const base = { ml_variation_id: '203734189745', ml_item_id: 'MLB6943015034', gtin: '7453000325513', codigo: '02841037' };
    const m = montarMapasCustoVigente([
      linha({ ...base, custo: 17.1224, atualizado_em: '2026-07-05T18:08:06Z' }),
      linha({ ...base, custo: 17.1224, atualizado_em: '2026-07-05T18:08:06Z' }),
      linha({ ...base, custo: 15.8558, atualizado_em: '2026-08-07T17:33:17Z' }),
    ]);
    expect(resolverCustoVigente(m, item({ variation_id: 203734189745 }))).toBe(15.8558);
    expect(resolverCustoVigente(m, item({ ml_item_id: 'MLB6943015034' }))).toBe(15.8558);
    expect(resolverCustoVigente(m, item({ ean: '7453000325513' }))).toBe(15.8558);
    expect(resolverCustoVigente(m, item({ codigo: '02841037' }))).toBe(15.8558);
  });

  it('custo que subiu também vale — o tie-break não tem lado', () => {
    const m = montarMapasCustoVigente([
      linha({ ml_variation_id: '9', custo: 10, atualizado_em: '2026-06-01T00:00:00Z' }),
      linha({ ml_variation_id: '9', custo: 25, atualizado_em: '2026-08-01T00:00:00Z' }),
    ]);
    expect(resolverCustoVigente(m, item({ variation_id: 9 }))).toBe(25);
  });

  it('data ausente não derruba linha datada; empate mantém a primeira', () => {
    const semData = montarMapasCustoVigente([
      linha({ ml_variation_id: '11', custo: 33, atualizado_em: '2026-08-01T00:00:00Z' }),
      linha({ ml_variation_id: '11', custo: 44, atualizado_em: null }),
    ]);
    expect(resolverCustoVigente(semData, item({ variation_id: 11 }))).toBe(33);

    const empate = montarMapasCustoVigente([
      linha({ ml_variation_id: '12', custo: 11, atualizado_em: null }),
      linha({ ml_variation_id: '12', custo: 22, atualizado_em: null }),
    ]);
    expect(resolverCustoVigente(empate, item({ variation_id: 12 }))).toBe(11);
  });

  it('data inválida é tratada como ausente', () => {
    const m = montarMapasCustoVigente([
      linha({ ml_variation_id: '13', custo: 33, atualizado_em: '2026-08-01T00:00:00Z' }),
      linha({ ml_variation_id: '13', custo: 44, atualizado_em: 'lixo' }),
    ]);
    expect(resolverCustoVigente(m, item({ variation_id: 13 }))).toBe(33);
  });
});

describe('montarMapasCustoVigente — descartes e normalização', () => {
  it('custo ≤ 0, null ou não numérico é ignorado', () => {
    const m = montarMapasCustoVigente([
      linha({ ml_variation_id: '1', custo: 0 }),
      linha({ ml_variation_id: '2', custo: -5 }),
      linha({ ml_variation_id: '3', custo: null }),
      linha({ ml_variation_id: '4', custo: 'abc' }),
    ]);
    for (const v of [1, 2, 3, 4]) expect(resolverCustoVigente(m, item({ variation_id: v }))).toBeNull();
  });

  it('GTIN e código casam com zeros à esquerda de qualquer lado (normGtin)', () => {
    const m = montarMapasCustoVigente([
      linha({ gtin: '0007891', custo: 55 }),
      linha({ codigo: '02841037', custo: 66 }),
    ]);
    expect(resolverCustoVigente(m, item({ ean: '7891' }))).toBe(55);
    expect(resolverCustoVigente(m, item({ codigo: '2841037' }))).toBe(66);
  });

  it('linha sem nenhuma chave não entra em mapa nenhum', () => {
    const m = montarMapasCustoVigente([linha({ custo: 99 })]);
    expect(resolverCustoVigente(m, item({ variation_id: 1, ml_item_id: 'A', ean: 'B', codigo: 'C' }))).toBeNull();
  });
});
