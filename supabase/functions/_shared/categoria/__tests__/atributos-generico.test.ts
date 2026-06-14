import { describe, it, expect } from 'vitest';
import { montarAtributosBase, atributosFaltantesGenerico, rotuloParaTipo } from '../atributos';
import type { AtributoSchema } from '../schema';

const SCHEMA: AtributoSchema[] = [
  { id: 'BRAND', nome: 'Marca', required: true, conditionalRequired: false, valores: [] },
  { id: 'MODEL', nome: 'Modelo', required: true, conditionalRequired: false, valores: [] },
  { id: 'VOLTAGE', nome: 'Voltagem', required: false, conditionalRequired: true, valores: [{ id: '1', nome: '110V' }] },
  { id: 'GTIN', nome: 'Código universal', required: false, conditionalRequired: true, valores: [] },
];

describe('rotuloParaTipo', () => {
  it('devolve o rótulo humano e null p/ outro', () => {
    expect(rotuloParaTipo('fita')).toBe('Fita de Cetim');
    expect(rotuloParaTipo('linha')).toBe('Fios e Cadarços');
    expect(rotuloParaTipo('outro')).toBeNull();
  });
});

describe('montarAtributosBase', () => {
  it('preenche BRAND (fornecedor) e MODEL (nome); closed-set fica vazio', () => {
    const a = montarAtributosBase(SCHEMA, 'Furadeira X 650W', 'Bosch');
    expect(a.find((x) => x.id === 'BRAND')?.value_name).toBe('Bosch');
    expect(a.find((x) => x.id === 'MODEL')?.value_name).toBe('Furadeira X 650W');
    expect(a.find((x) => x.id === 'VOLTAGE')).toBeUndefined();
  });
  it('marca vazia → fallback Avil; só inclui o que o schema expõe', () => {
    const a = montarAtributosBase([{ id: 'BRAND', nome: 'Marca', required: true, conditionalRequired: false, valores: [] }], 'Caneta', '');
    expect(a).toEqual([{ id: 'BRAND', value_name: 'Avil' }]);
  });
});

describe('atributosFaltantesGenerico', () => {
  it('lista required não preenchidos; ignora GTIN; ignora os preenchidos', () => {
    const base = montarAtributosBase(SCHEMA, 'Furadeira X', 'Bosch'); // preenche BRAND+MODEL
    // VOLTAGE falta (closed-set, E4); GTIN é ignorado (resolvido na publicação).
    expect(atributosFaltantesGenerico(base, SCHEMA)).toEqual(['Voltagem']);
  });
  it('tudo preenchido → []', () => {
    const tem = [{ id: 'BRAND', value_name: 'X' }, { id: 'MODEL', value_name: 'Y' }, { id: 'VOLTAGE', value_id: '1' }];
    expect(atributosFaltantesGenerico(tem, SCHEMA)).toEqual([]);
  });
});
