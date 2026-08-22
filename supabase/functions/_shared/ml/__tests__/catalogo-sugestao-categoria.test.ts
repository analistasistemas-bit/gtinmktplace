// Sugestão de categoria pela ficha de catálogo (spec 2026-08-22). O que estes testes travam:
//  - a sugestão só nasce com divergência de domínio + ficha aprovada pela trava anti-kit;
//  - `esperado` pré-publicação NUNCA carrega domainId (senão a própria divergência que
//    queremos sinalizar reprovaria a equivalência e suprimiria a sugestão).
import { describe, expect, it } from 'vitest';
import {
  deveSugerirCategoriaPorFicha,
  montarEsperadoPrePublicacao,
  type AtributosFicha,
} from '../catalogo';

// Caso real do lote 21: GTIN 4005800223136 (Eucerin Aquaphor 55ml).
const fichaCorporal: AtributosFicha = {
  id: 'MLB19462147', saleFormat: null, unitsPerPack: null, lengthM: null,
  domainId: 'MLB-BODY_SKIN_CARE_PRODUCTS',
};
const DOMINIO_BEBES = 'MLB-BABY_CREAMS_AND_OINTMENTS';

describe('deveSugerirCategoriaPorFicha', () => {
  it('sugere quando o domínio da ficha diverge do da categoria escolhida (caso Aquaphor)', () => {
    expect(deveSugerirCategoriaPorFicha(fichaCorporal, montarEsperadoPrePublicacao([]), DOMINIO_BEBES)).toBe(true);
  });

  it('não sugere quando os domínios coincidem', () => {
    expect(deveSugerirCategoriaPorFicha(fichaCorporal, montarEsperadoPrePublicacao([]), 'MLB-BODY_SKIN_CARE_PRODUCTS')).toBe(false);
  });

  it('não sugere sem ficha, sem domínio da ficha ou sem domínio da categoria', () => {
    expect(deveSugerirCategoriaPorFicha(null, montarEsperadoPrePublicacao([]), DOMINIO_BEBES)).toBe(false);
    expect(deveSugerirCategoriaPorFicha({ ...fichaCorporal, domainId: null }, montarEsperadoPrePublicacao([]), DOMINIO_BEBES)).toBe(false);
    expect(deveSugerirCategoriaPorFicha(fichaCorporal, montarEsperadoPrePublicacao([]), null)).toBe(false);
  });

  it('ficha de kit reprovada pela trava anti-kit não gera sugestão', () => {
    const fichaKit10 = { ...fichaCorporal, unitsPerPack: 10, saleFormat: 'Kit' };
    expect(deveSugerirCategoriaPorFicha(fichaKit10, montarEsperadoPrePublicacao([]), DOMINIO_BEBES)).toBe(false);
  });

  it('kit legítimo (nosso 2un × ficha 2un) segue elegível para sugestão', () => {
    const fichaKit2 = { ...fichaCorporal, unitsPerPack: 2, saleFormat: 'Kit' };
    const esperado = montarEsperadoPrePublicacao([
      { id: 'UNITS_PER_PACK', value_name: '2' },
      { id: 'SALE_FORMAT', value_name: 'Kit' },
    ]);
    expect(deveSugerirCategoriaPorFicha(fichaKit2, esperado, DOMINIO_BEBES)).toBe(true);
  });

  it('domainId que vaze no esperado é neutralizado (a divergência não reprova a equivalência)', () => {
    // Se o domainId chegasse à fichaEquivalente, este caso viraria false — regressão.
    const esperadoComVazamento = { lengthM: null, domainId: DOMINIO_BEBES };
    expect(deveSugerirCategoriaPorFicha(fichaCorporal, esperadoComVazamento, DOMINIO_BEBES)).toBe(true);
  });
});

describe('montarEsperadoPrePublicacao', () => {
  it('extrai UNITS_PER_PACK/SALE_FORMAT/LENGTH dos atributos já calculados', () => {
    expect(montarEsperadoPrePublicacao([
      { id: 'UNITS_PER_PACK', value_name: '2' },
      { id: 'SALE_FORMAT', value_name: 'Kit' },
      { id: 'LENGTH', value_name: '10 m' },
    ])).toEqual({ lengthM: 10, unitsPerPack: 2, saleFormat: 'Kit', domainId: null });
  });

  it('sem atributos → 1 unidade avulsa (mesmo modo degradado do vincular-catalogo)', () => {
    expect(montarEsperadoPrePublicacao([])).toEqual({ lengthM: null, unitsPerPack: null, saleFormat: null, domainId: null });
  });

  it('UNITS_PER_PACK não numérico não vira NaN', () => {
    expect(montarEsperadoPrePublicacao([{ id: 'UNITS_PER_PACK', value_name: 'dois' }]).unitsPerPack).toBeNull();
  });
});
