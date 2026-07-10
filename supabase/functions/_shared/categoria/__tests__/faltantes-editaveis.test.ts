import { describe, it, expect } from 'vitest';
import { faltantesEditaveis, validarValorAtributo } from '../faltantes-editaveis';
import type { AtributoSchema } from '../schema';

const A = (o: Partial<AtributoSchema> & { id: string }): AtributoSchema => ({
  nome: o.id, required: false, conditionalRequired: false, valueType: 'string', valores: [], allowedUnits: [], tags: [], ...o,
});
const SCHEMA: AtributoSchema[] = [
  A({ id: 'BRAND', nome: 'Marca', required: true }),
  A({ id: 'MODEL', nome: 'Modelo', required: true }),
  A({ id: 'VOLTAGE', nome: 'Voltagem', required: true, valueType: 'list', valores: [{ id: '1', nome: '110V' }, { id: '2', nome: '220V' }] }),
  A({ id: 'LENGTH', nome: 'Comprimento', conditionalRequired: true, valueType: 'number_unit', allowedUnits: [{ id: 'cm', nome: 'cm' }] }),
  A({ id: 'COLOR', nome: 'Cor', required: true, valueType: 'list', valores: [{ id: '9', nome: 'Preto' }] }), // variação → ignorado
  A({ id: 'IMPORT', nome: 'Imposto', required: true, valueType: 'list', valores: [{ id: '7', nome: '0%' }], tags: ['read_only'] }), // read-only → ignorado
  A({ id: 'NOTE', nome: 'Observação', required: false }), // opcional → não é faltante
  // string com sugestões (não lista fechada) — ex.: MATERIAL em Pingentes (lote #31)
  A({ id: 'MATERIAL', nome: 'Material', required: true, valueType: 'string', valores: [{ id: '1', nome: 'Alpaca' }, { id: '2', nome: 'Ouro' }] }),
];

describe('faltantesEditaveis', () => {
  it('lista obrigatórios não preenchidos com tipo/valores; ignora COLOR/read-only/opcional', () => {
    const campos = faltantesEditaveis(SCHEMA, [{ id: 'BRAND', value_name: 'Avil' }]);
    expect(campos.map((c) => c.id)).toEqual(['MODEL', 'VOLTAGE', 'LENGTH', 'MATERIAL']);
    expect(campos.find((c) => c.id === 'MODEL')?.tipo).toBe('texto');
    expect(campos.find((c) => c.id === 'VOLTAGE')?.tipo).toBe('closed');
    expect(campos.find((c) => c.id === 'VOLTAGE')?.valores).toEqual([{ id: '1', nome: '110V' }, { id: '2', nome: '220V' }]);
    expect(campos.find((c) => c.id === 'LENGTH')?.tipo).toBe('numero');
    expect(campos.find((c) => c.id === 'LENGTH')?.unidades).toEqual([{ id: 'cm', nome: 'cm' }]);
  });
  it('MATERIAL (value_type=string com sugestões) é texto-livre, não closed-set', () => {
    const campos = faltantesEditaveis(SCHEMA, [{ id: 'BRAND', value_name: 'Avil' }]);
    expect(campos.find((c) => c.id === 'MATERIAL')?.tipo).toBe('texto');
  });
  it('tudo preenchido → []', () => {
    const cheio = [{ id: 'MODEL', value_name: 'X' }, { id: 'VOLTAGE', value_id: '1' }, { id: 'LENGTH', value_name: '10 cm' }, { id: 'BRAND', value_name: 'Avil' }, { id: 'MATERIAL', value_name: '100% Poliéster' }];
    expect(faltantesEditaveis(SCHEMA, cheio)).toEqual([]);
  });
});

describe('validarValorAtributo', () => {
  it('closed-set por id', () => {
    expect(validarValorAtributo(SCHEMA, 'VOLTAGE', '2')).toEqual({ id: 'VOLTAGE', value_id: '2' });
  });
  it('closed-set por nome (fuzzy)', () => {
    expect(validarValorAtributo(SCHEMA, 'VOLTAGE', '110v')).toEqual({ id: 'VOLTAGE', value_id: '1' });
  });
  it('closed-set inválido → null', () => {
    expect(validarValorAtributo(SCHEMA, 'VOLTAGE', '380V')).toBeNull();
  });
  it('numérico com unidade permitida', () => {
    expect(validarValorAtributo(SCHEMA, 'LENGTH', '10 cm')).toEqual({ id: 'LENGTH', value_name: '10 cm' });
  });
  it('numérico com unidade fora da lista → null', () => {
    expect(validarValorAtributo(SCHEMA, 'LENGTH', '10 polegadas')).toBeNull();
  });
  it('texto livre (operador) → aceita trim, sem exigir constar na fonte', () => {
    expect(validarValorAtributo(SCHEMA, 'MODEL', '  Barbante 4/6  ')).toEqual({ id: 'MODEL', value_name: 'Barbante 4/6' });
  });
  it('texto vazio → null', () => {
    expect(validarValorAtributo(SCHEMA, 'MODEL', '   ')).toBeNull();
  });
  it('MATERIAL (string com sugestões) aceita valor fora das sugestões', () => {
    expect(validarValorAtributo(SCHEMA, 'MATERIAL', '100% Poliéster')).toEqual({ id: 'MATERIAL', value_name: '100% Poliéster' });
  });
  it('atributo fora do schema → null', () => {
    expect(validarValorAtributo(SCHEMA, 'XPTO', 'x')).toBeNull();
  });
});
