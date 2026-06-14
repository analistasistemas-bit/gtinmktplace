import { describe, it, expect } from 'vitest';
import { parseAtributosSchema, idsObrigatorios, nomesObrigatorios } from '../schema';

// Shape real do probe 2026-06-14 (MLB189007 furadeira).
const REAL = [
  { id: 'BRAND', name: 'Marca', tags: { required: true, catalog_required: true }, values: [] },
  { id: 'VOLTAGE', name: 'Voltagem', tags: { conditional_required: true, allow_variations: true }, values: [{ id: '1', name: '110V' }, { id: '2', name: '220V' }] },
  { id: 'COLOR', name: 'Cor', tags: {}, values: [{ id: '9', name: 'Preto' }] },
];

describe('parseAtributosSchema', () => {
  it('parseia flags e values', () => {
    const s = parseAtributosSchema(REAL);
    expect(s[0]).toEqual({ id: 'BRAND', nome: 'Marca', required: true, conditionalRequired: false, valores: [] });
    expect(s[1].conditionalRequired).toBe(true);
    expect(s[1].valores).toEqual([{ id: '1', nome: '110V' }, { id: '2', nome: '220V' }]);
    expect(s[2].required).toBe(false);
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
