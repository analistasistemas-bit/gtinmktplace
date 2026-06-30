import { describe, it, expect } from 'vitest';
import { parseAtributosSchema, idsObrigatorios, nomesObrigatorios } from '../schema';

// Shape real do probe 2026-06-14 (MLB189007 furadeira) + numéricos (fita: LENGTH/WIDTH).
const REAL = [
  { id: 'BRAND', name: 'Marca', value_type: 'string', tags: { required: true, catalog_required: true }, values: [] },
  { id: 'VOLTAGE', name: 'Voltagem', value_type: 'list', tags: { conditional_required: true, allow_variations: true }, values: [{ id: '1', name: '110V' }, { id: '2', name: '220V' }] },
  { id: 'COLOR', name: 'Cor', value_type: 'list', tags: {}, values: [{ id: '9', name: 'Preto' }] },
  { id: 'LENGTH', name: 'Comprimento', value_type: 'number_unit', tags: {}, values: [], allowed_units: [{ id: 'cm', name: 'cm' }, { id: 'm', name: 'm' }] },
  { id: 'UNITS_PER_PACK', name: 'Unidades por embalagem', value_type: 'number', tags: {}, values: [] },
];

describe('parseAtributosSchema', () => {
  it('parseia flags, values, value_type, allowed_units e tags', () => {
    const s = parseAtributosSchema(REAL);
    expect(s[0]).toEqual({ id: 'BRAND', nome: 'Marca', required: true, conditionalRequired: false, valueType: 'string', valores: [], allowedUnits: [], tags: ['required', 'catalog_required'] });
    expect(s[1].conditionalRequired).toBe(true);
    expect(s[1].valores).toEqual([{ id: '1', nome: '110V' }, { id: '2', nome: '220V' }]);
    expect(s[2].required).toBe(false);
    expect(s[3]).toMatchObject({ id: 'LENGTH', valueType: 'number_unit', allowedUnits: [{ id: 'cm', nome: 'cm' }, { id: 'm', nome: 'm' }] });
    expect(s[4]).toMatchObject({ id: 'UNITS_PER_PACK', valueType: 'number', allowedUnits: [] });
  });

  it('value_type ausente → string', () => {
    expect(parseAtributosSchema([{ id: 'X', name: 'X', values: [] }])[0].valueType).toBe('string');
  });

  it('não-array → []', () => {
    expect(parseAtributosSchema(null)).toEqual([]);
    expect(parseAtributosSchema({})).toEqual([]);
  });
});

describe('obrigatórios', () => {
  it('idsObrigatorios inclui required + conditional_required', () => {
    expect(idsObrigatorios(parseAtributosSchema(REAL)).sort()).toEqual(['BRAND', 'VOLTAGE']);
  });
  it('nomesObrigatorios devolve os nomes humanos', () => {
    expect(nomesObrigatorios(parseAtributosSchema(REAL))).toEqual(['Marca', 'Voltagem']);
  });
});
