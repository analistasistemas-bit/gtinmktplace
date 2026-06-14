import { describe, it, expect } from 'vitest';
import {
  atributosAlvo,
  validarRespostaAtributos,
  montarPromptAtributos,
  preencherAtributosClosedSet,
} from '../atributos-llm-core';
import type { AtributoSchema } from '../../categoria/schema';

const SCHEMA: AtributoSchema[] = [
  { id: 'BRAND', nome: 'Marca', required: true, conditionalRequired: false, valores: [] }, // texto livre
  { id: 'MODEL', nome: 'Modelo', required: true, conditionalRequired: false, valores: [] }, // texto livre
  { id: 'VOLTAGE', nome: 'Voltagem', required: false, conditionalRequired: true, valores: [{ id: '1', nome: '110V' }, { id: '2', nome: '220V' }, { id: '3', nome: 'Bivolt' }] },
  { id: 'GTIN', nome: 'GTIN', required: false, conditionalRequired: true, valores: [] },
  { id: 'COLOR', nome: 'Cor', required: false, conditionalRequired: false, valores: [{ id: '9', nome: 'Preto' }] },
];
const base = [{ id: 'BRAND', value_name: 'Bosch' }, { id: 'MODEL', value_name: 'Furadeira X' }];

describe('atributosAlvo', () => {
  it('só obrigatórios closed-set não preenchidos (ignora texto-livre, GTIN, não-obrigatório)', () => {
    const alvos = atributosAlvo(SCHEMA, base);
    expect(alvos.map((a) => a.id)).toEqual(['VOLTAGE']); // BRAND/MODEL preenchidos+texto; GTIN ignorado; COLOR não-obrig.
    expect(alvos[0].valores).toHaveLength(3);
  });
  it('VOLTAGE já preenchido → não é alvo', () => {
    expect(atributosAlvo(SCHEMA, [...base, { id: 'VOLTAGE', value_id: '3' }])).toEqual([]);
  });
});

describe('validarRespostaAtributos (closed-set)', () => {
  const alvos = atributosAlvo(SCHEMA, base);
  it('value_id válido entra', () => {
    expect(validarRespostaAtributos({ VOLTAGE: '3' }, alvos)).toEqual([{ id: 'VOLTAGE', value_id: '3' }]);
  });
  it('casa por value_name (fuzzy) normalizado', () => {
    expect(validarRespostaAtributos({ VOLTAGE: 'bivolt' }, alvos)).toEqual([{ id: 'VOLTAGE', value_id: '3' }]);
  });
  it('valor fora da lista → omitido', () => {
    expect(validarRespostaAtributos({ VOLTAGE: '380V' }, alvos)).toEqual([]);
  });
  it('vazio → []', () => {
    expect(validarRespostaAtributos({}, alvos)).toEqual([]);
  });
});

describe('montarPromptAtributos', () => {
  it('lista os valores permitidos', () => {
    const p = montarPromptAtributos({ nome: 'Furadeira', descricao: '650W bivolt' }, atributosAlvo(SCHEMA, base));
    expect(p).toContain('VOLTAGE');
    expect(p).toContain('Bivolt');
    expect(p).toContain('650W bivolt');
  });
});

describe('preencherAtributosClosedSet', () => {
  it('sem alvos → base, sem chamar IA', async () => {
    let chamou = false;
    const r = await preencherAtributosClosedSet(SCHEMA, [...base, { id: 'VOLTAGE', value_id: '1' }], { nome: 'X' }, async () => { chamou = true; return {}; });
    expect(chamou).toBe(false);
    expect(r).toHaveLength(3);
  });
  it('com alvo → IA preenche e faz merge', async () => {
    const r = await preencherAtributosClosedSet(SCHEMA, base, { nome: 'Furadeira', descricao: 'bivolt' }, async () => ({ VOLTAGE: '3' }));
    expect(r).toContainEqual({ id: 'VOLTAGE', value_id: '3' });
    expect(r).toHaveLength(3);
  });
  it('IA falha → base (resiliente)', async () => {
    const r = await preencherAtributosClosedSet(SCHEMA, base, { nome: 'X' }, async () => { throw new Error('rede'); });
    expect(r).toEqual(base);
  });
  it('IA devolve valor inválido → base (omitido)', async () => {
    const r = await preencherAtributosClosedSet(SCHEMA, base, { nome: 'X' }, async () => ({ VOLTAGE: '380V' }));
    expect(r).toEqual(base);
  });
});
