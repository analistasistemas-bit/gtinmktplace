import { describe, it, expect } from 'vitest';
import { atributosDivergentes } from '../atributos-divergentes';

/**
 * Ficha real de `MLB5197880975` (Lantejoula Holográfica Carnaval, org Avil) lida do ML em
 * 07/09/2026, depois de o UPDATE ter rodado sem propagar nada. É o caso que motivou o ADR-0157:
 * `familias.atributos_ml` já estava corrigido no banco e o anúncio seguia com Kit / 8.
 */
const NO_ML = [
  { id: 'BRAND', value_id: '9165622', value_name: 'Búfalo' },
  { id: 'MODEL', value_id: null, value_name: 'LANTEJOULAS HOLOGRAFICA TAM 8 CORES C/50MT' },
  { id: 'DIAMETER', value_id: null, value_name: '8 mm' },
  { id: 'SEQUIN_SHAPE', value_id: null, value_name: 'LANTEJOULA HOLOGRÁFICA TRANÇADA LISA' },
  { id: 'UNITS_PER_PACK', value_id: null, value_name: '8' },
  { id: 'SALE_FORMAT', value_id: '1359392', value_name: 'Kit' },
  { id: 'COLOR', value_id: '52049', value_name: 'Dourado' },
  { id: 'COMPOSITION', value_id: '4904381', value_name: '100% poliéster' },
];

const CORRIGIDO = [
  { id: 'BRAND', value_name: 'BUFALO' },
  { id: 'MODEL', value_name: 'LANTEJOULAS HOLOGRAFICA TAM 8 CORES C/50MT' },
  { id: 'DIAMETER', value_name: '8 mm' },
  { id: 'SEQUIN_SHAPE', value_name: 'LANTEJOULA HOLOGRÁFICA TRANÇADA LISA' },
  { id: 'UNITS_PER_PACK', value_name: '1' },
  { id: 'SALE_FORMAT', value_id: '1359391' },
];

describe('atributosDivergentes (ADR-0157)', () => {
  it('manda só o que mudou: as condições de venda erradas do ADR-0156', () => {
    expect(atributosDivergentes(CORRIGIDO, NO_ML)).toEqual([
      { id: 'UNITS_PER_PACK', value_name: '1' },
      { id: 'SALE_FORMAT', value_id: '1359391' },
    ]);
  });

  it('nada diverge → lista vazia (o PUT segue sem attributes, como antes)', () => {
    const igual = [
      { id: 'DIAMETER', value_name: '8 mm' },
      { id: 'SALE_FORMAT', value_id: '1359392' },
    ];
    expect(atributosDivergentes(igual, NO_ML)).toEqual([]);
  });

  it('não reenvia o BRAND que o ML normalizou (BUFALO cru → Búfalo com value_id)', () => {
    // `familias.atributos_ml` guarda "BUFALO", texto do campo fornecedor, sem value_id; o ML tem
    // 9165622 + "Búfalo". Comparar por nome acusaria divergência e o PUT reescreveria a
    // identidade da família — foi o que desagrupou a cor Preta no lote 54 (ADR-0088).
    expect(atributosDivergentes([{ id: 'BRAND', value_name: 'BUFALO' }], NO_ML)).toEqual([]);
  });

  it('nosso value_id contra value_id diferente do ML diverge (é o SALE_FORMAT do ADR-0156)', () => {
    const ml = [{ id: 'SALE_FORMAT', value_id: '1359392', value_name: null }];
    expect(atributosDivergentes([{ id: 'SALE_FORMAT', value_id: '1359391' }], ml))
      .toEqual([{ id: 'SALE_FORMAT', value_id: '1359391' }]);
  });

  it('compara nome sem caixa nem espaço sobrando (não reabre PUT à toa)', () => {
    const ml = [{ id: 'SEQUIN_SHAPE', value_name: 'Lantejoula Trançada  ' }];
    expect(atributosDivergentes([{ id: 'SEQUIN_SHAPE', value_name: ' lantejoula trançada' }], ml))
      .toEqual([]);
  });

  it('nunca manda atributo por SKU nem de embalagem', () => {
    const nossos = [
      { id: 'COLOR', value_name: 'Prata 23' },
      { id: 'GTIN', value_name: '3000029949844' },
      { id: 'SELLER_SKU', value_name: '02994984' },
      { id: 'EMPTY_GTIN_REASON', value_id: '123' },
      { id: 'SELLER_PACKAGE_HEIGHT', value_name: '8' },
    ];
    expect(atributosDivergentes(nossos, NO_ML)).toEqual([]);
  });

  it('atributo que o ML ainda não tem entra no PUT', () => {
    expect(atributosDivergentes([{ id: 'PRODUCT_TYPE', value_name: 'Rolo' }], NO_ML))
      .toEqual([{ id: 'PRODUCT_TYPE', value_name: 'Rolo' }]);
  });

  it('ignora entrada malformada e atributo sem valor', () => {
    expect(atributosDivergentes([{ id: 'X' }, { value_name: 'sem id' }, null], NO_ML)).toEqual([]);
    expect(atributosDivergentes(null, NO_ML)).toEqual([]);
    expect(atributosDivergentes(CORRIGIDO, null)).toHaveLength(6);
  });

  it('não repete o mesmo id quando atributos_ml traz duplicata', () => {
    const dup = [{ id: 'UNITS_PER_PACK', value_name: '1' }, { id: 'UNITS_PER_PACK', value_name: '2' }];
    expect(atributosDivergentes(dup, NO_ML)).toEqual([{ id: 'UNITS_PER_PACK', value_name: '1' }]);
  });
});
