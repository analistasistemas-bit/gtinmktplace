import { describe, it, expect } from 'vitest';
import {
  atributosAlvo,
  validarRespostaAtributos,
  montarPromptAtributos,
  preencherAtributosClosedSet,
} from '../atributos-llm-core';
import type { AtributoSchema } from '../../categoria/schema';

const A = (o: Partial<AtributoSchema> & { id: string }): AtributoSchema => ({
  nome: o.id, required: false, conditionalRequired: false, valueType: 'string', valores: [], allowedUnits: [], tags: [], ...o,
});
const SCHEMA: AtributoSchema[] = [
  A({ id: 'BRAND', nome: 'Marca', required: true }), // texto livre
  A({ id: 'MODEL', nome: 'Modelo', required: true }), // texto livre
  A({ id: 'VOLTAGE', nome: 'Voltagem', conditionalRequired: true, valueType: 'list', valores: [{ id: '1', nome: '110V' }, { id: '2', nome: '220V' }, { id: '3', nome: 'Bivolt' }] }),
  A({ id: 'RIBBON_FORMAT', nome: 'Formato da fita', valueType: 'list', valores: [{ id: '5', nome: 'Rolo' }, { id: '6', nome: 'Unidade' }] }), // opcional closed-set
  A({ id: 'LENGTH', nome: 'Comprimento', valueType: 'number_unit', allowedUnits: [{ id: 'cm', nome: 'cm' }, { id: 'm', nome: 'm' }] }), // numérico c/ unidade
  A({ id: 'GTIN', nome: 'GTIN', conditionalRequired: true }),
  A({ id: 'COLOR', nome: 'Cor', valueType: 'list', valores: [{ id: '9', nome: 'Preto' }] }), // atributo de variação (IGNORAR)
  A({ id: 'MAIN_COLOR', nome: 'Cor principal', valueType: 'list', valores: [{ id: '9', nome: 'Preto' }], tags: ['variation_attribute'] }), // por variação
  A({ id: 'IMPORT_DUTY', nome: 'Imposto', valueType: 'list', valores: [{ id: '7', nome: '0%' }], tags: ['hidden', 'read_only'] }), // oculto/read-only
  A({ id: 'PRODUCT_FEATURES', nome: 'Características', valueType: 'list', valores: [{ id: '8', nome: 'X' }], tags: ['multivalued', 'read_only'] }), // multivalor
];
const base = [{ id: 'BRAND', value_name: 'Bosch' }, { id: 'MODEL', value_name: 'Furadeira X' }];

describe('atributosAlvo', () => {
  it('closed-set (obrig. e opcional) + numéricos não preenchidos; ignora texto-livre, GTIN, COLOR', () => {
    const alvos = atributosAlvo(SCHEMA, base);
    expect(alvos.map((a) => a.id)).toEqual(['VOLTAGE', 'RIBBON_FORMAT', 'LENGTH']);
    expect(alvos.find((a) => a.id === 'LENGTH')?.unidades).toEqual([{ id: 'cm', nome: 'cm' }, { id: 'm', nome: 'm' }]);
  });
  it('exclui variation_attribute, hidden/read_only e multivalued', () => {
    const ids = atributosAlvo(SCHEMA, base).map((a) => a.id);
    expect(ids).not.toContain('MAIN_COLOR');
    expect(ids).not.toContain('IMPORT_DUTY');
    expect(ids).not.toContain('PRODUCT_FEATURES');
  });
  it('atributo já preenchido → não é alvo', () => {
    const r = atributosAlvo(SCHEMA, [...base, { id: 'VOLTAGE', value_id: '3' }, { id: 'RIBBON_FORMAT', value_id: '5' }, { id: 'LENGTH', value_name: '10 cm' }]);
    expect(r).toEqual([]);
  });
});

describe('validarRespostaAtributos (closed-set)', () => {
  const alvos = atributosAlvo(SCHEMA, base);
  it('value_id válido entra', () => {
    expect(validarRespostaAtributos({ VOLTAGE: '3' }, alvos)).toContainEqual({ id: 'VOLTAGE', value_id: '3' });
  });
  it('casa por value_name (fuzzy) normalizado', () => {
    expect(validarRespostaAtributos({ RIBBON_FORMAT: 'rolo' }, alvos)).toContainEqual({ id: 'RIBBON_FORMAT', value_id: '5' });
  });
  it('valor fora da lista → omitido', () => {
    expect(validarRespostaAtributos({ VOLTAGE: '380V' }, alvos)).toEqual([]);
  });
  it('vazio → []', () => {
    expect(validarRespostaAtributos({}, alvos)).toEqual([]);
  });
});

describe('validarRespostaAtributos (numérico)', () => {
  const alvos = atributosAlvo(SCHEMA, base);
  it('número + unidade permitida → value_name', () => {
    expect(validarRespostaAtributos({ LENGTH: '2500 cm' }, alvos)).toContainEqual({ id: 'LENGTH', value_name: '2500 cm' });
  });
  it('aceita vírgula decimal e normaliza', () => {
    expect(validarRespostaAtributos({ LENGTH: '2,5 m' }, alvos)).toContainEqual({ id: 'LENGTH', value_name: '2.5 m' });
  });
  it('unidade fora da lista → omitido (não chuta unidade)', () => {
    expect(validarRespostaAtributos({ LENGTH: '10 polegadas' }, alvos)).toEqual([]);
  });
  it('sem unidade num number_unit → omitido', () => {
    expect(validarRespostaAtributos({ LENGTH: '10' }, alvos)).toEqual([]);
  });
  it('não-número → omitido', () => {
    expect(validarRespostaAtributos({ LENGTH: 'grande' }, alvos)).toEqual([]);
  });
  it('unidade permitida vazia ("") + número sem unidade → omitido (não vira "2500 ")', () => {
    const alvoUnidVazia = atributosAlvo([A({ id: 'LEN2', valueType: 'number_unit', allowedUnits: [{ id: '', nome: '' }, { id: 'cm', nome: 'cm' }] })], []);
    expect(validarRespostaAtributos({ LEN2: '2500' }, alvoUnidVazia)).toEqual([]);
    expect(validarRespostaAtributos({ LEN2: '2500 cm' }, alvoUnidVazia)).toEqual([{ id: 'LEN2', value_name: '2500 cm' }]);
  });
});

describe('montarPromptAtributos', () => {
  it('lista valores closed-set e formato numérico', () => {
    const p = montarPromptAtributos({ nome: 'Fita', descricao: 'rolo 25m veludo' }, atributosAlvo(SCHEMA, base));
    expect(p).toContain('VOLTAGE');
    expect(p).toContain('Bivolt');
    expect(p).toContain('rolo 25m veludo');
    expect(p).toContain('LENGTH');
    expect(p).toContain('unidade (uma de: cm, m)');
  });
});

describe('preencherAtributosClosedSet', () => {
  const cheio = [...base, { id: 'VOLTAGE', value_id: '1' }, { id: 'RIBBON_FORMAT', value_id: '5' }, { id: 'LENGTH', value_name: '10 cm' }];
  it('sem alvos → base, sem chamar IA', async () => {
    let chamou = false;
    const r = await preencherAtributosClosedSet(SCHEMA, cheio, { nome: 'X' }, async () => { chamou = true; return {}; });
    expect(chamou).toBe(false);
    expect(r).toEqual(cheio);
  });
  it('com alvo → IA preenche (closed-set + numérico) e faz merge', async () => {
    const r = await preencherAtributosClosedSet(SCHEMA, base, { nome: 'Fita', descricao: 'rolo 25m' }, async () => ({ RIBBON_FORMAT: '5', LENGTH: '2500 cm' }));
    expect(r).toContainEqual({ id: 'RIBBON_FORMAT', value_id: '5' });
    expect(r).toContainEqual({ id: 'LENGTH', value_name: '2500 cm' });
  });
  it('IA falha → base (resiliente)', async () => {
    const r = await preencherAtributosClosedSet(SCHEMA, base, { nome: 'X' }, async () => { throw new Error('rede'); });
    expect(r).toEqual(base);
  });
  it('IA devolve valor inválido → base (omitido)', async () => {
    const r = await preencherAtributosClosedSet(SCHEMA, base, { nome: 'X' }, async () => ({ VOLTAGE: '380V', LENGTH: '10 polegadas' }));
    expect(r).toEqual(base);
  });
});
