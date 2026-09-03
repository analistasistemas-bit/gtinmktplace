import { describe, it, expect } from 'vitest';
import { atributosDeFicha, mesclarAtributos } from '../atributos-irmao';

/**
 * Caso real do lote 54 (03/09/2026): a ficha lida do irmão `MLB7275447754`, que está na família
 * certa. É ela que a cor nova precisa copiar — `value_id` incluído, porque é o que diferencia
 * "Búfalo" do dicionário (9165622) do texto livre "BUFALO" que o app mandava.
 */
const FICHA_DO_IRMAO = [
  { id: 'BRAND', value_id: '9165622', value_name: 'Búfalo' },
  { id: 'MANUFACTURER', value_id: '9165622', value_name: 'Búfalo' },
  { id: 'COMPOSITION', value_id: '4904381', value_name: '100% poliéster' },
  { id: 'MODEL', value_id: null, value_name: 'Tecido Helanca Light Helanquinha Forro Decoração 10 Metros' },
  { id: 'PRODUCT_TYPE', value_id: '46917948', value_name: 'Rolo' },
  { id: 'COLOR', value_id: '52024', value_name: 'Azul-petróleo' },
  { id: 'GTIN', value_id: null, value_name: '4753000253' },
  { id: 'SELLER_PACKAGE_WEIGHT', value_id: null, value_name: '2330 g' },
  { id: 'SELLER_PACKAGE_HEIGHT', value_id: null, value_name: '27 cm' },
];

describe('atributosDeFicha', () => {
  it('preserva value_id — é ele que casa com o dicionário do ML', () => {
    const r = atributosDeFicha(FICHA_DO_IRMAO);
    expect(r).toContainEqual({ id: 'BRAND', value_id: '9165622' });
    expect(r).toContainEqual({ id: 'COMPOSITION', value_id: '4904381' });
  });

  it('usa value_name quando o atributo não tem value_id', () => {
    expect(atributosDeFicha(FICHA_DO_IRMAO)).toContainEqual({
      id: 'MODEL', value_name: 'Tecido Helanca Light Helanquinha Forro Decoração 10 Metros',
    });
  });

  it('NUNCA copia o que é por SKU: copiar COLOR/GTIN publicaria a cor nova como a antiga', () => {
    const ids = atributosDeFicha(FICHA_DO_IRMAO).map((a) => a.id);
    expect(ids).not.toContain('COLOR');
    expect(ids).not.toContain('GTIN');
    expect(atributosDeFicha([{ id: 'EMPTY_GTIN_REASON', value_id: '17055160' }])).toEqual([]);
  });

  it('não copia dimensões: são dado nosso (frete, ADR-0018) e o UP não as sincroniza depois', () => {
    const ids = atributosDeFicha(FICHA_DO_IRMAO).map((a) => a.id);
    expect(ids.filter((i) => i.startsWith('SELLER_PACKAGE_'))).toEqual([]);
  });

  it('entrada inválida ou vazia devolve lista vazia (o fluxo segue sem herança)', () => {
    expect(atributosDeFicha(null)).toEqual([]);
    expect(atributosDeFicha([{ semId: true }])).toEqual([]);
    expect(atributosDeFicha([{ id: 'X' }])).toEqual([]);
  });
});

describe('mesclarAtributos', () => {
  it('o irmão vence: é o valor já publicado que decide se o ML agrupa', () => {
    const r = mesclarAtributos(
      [{ id: 'BRAND', value_name: 'BUFALO' }],
      [{ id: 'BRAND', value_id: '9165622' }],
    );
    expect(r).toEqual([{ id: 'BRAND', value_id: '9165622' }]);
  });

  it('atributo que só a família tem continua chegando ao anúncio', () => {
    const r = mesclarAtributos(
      [{ id: 'BRAND', value_name: 'BUFALO' }, { id: 'LENGTH', value_name: '10 m' }],
      [{ id: 'BRAND', value_id: '9165622' }],
    );
    expect(r).toEqual([{ id: 'BRAND', value_id: '9165622' }, { id: 'LENGTH', value_name: '10 m' }]);
  });

  it('sem ficha do irmão (GET falhou), fica exatamente o comportamento anterior', () => {
    const daFamilia = [{ id: 'BRAND', value_name: 'BUFALO' }];
    expect(mesclarAtributos(daFamilia, [])).toEqual(daFamilia);
  });

  it('atributos_ml ausente/não-array não quebra a mescla', () => {
    expect(mesclarAtributos(undefined, [{ id: 'BRAND', value_id: '1' }])).toEqual([{ id: 'BRAND', value_id: '1' }]);
    expect(mesclarAtributos(null, [])).toEqual([]);
  });
});
