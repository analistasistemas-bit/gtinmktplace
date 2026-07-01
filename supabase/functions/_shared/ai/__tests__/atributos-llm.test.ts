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
  A({ id: 'LINE', nome: 'Linha/Coleção', required: true }), // texto livre OBRIGATÓRIO (não preenchido por base)
  A({ id: 'VOLTAGE', nome: 'Voltagem', conditionalRequired: true, valueType: 'list', valores: [{ id: '1', nome: '110V' }, { id: '2', nome: '220V' }, { id: '3', nome: 'Bivolt' }] }),
  A({ id: 'RIBBON_FORMAT', nome: 'Formato da fita', valueType: 'list', valores: [{ id: '5', nome: 'Rolo' }, { id: '6', nome: 'Unidade' }] }), // opcional closed-set
  A({ id: 'LENGTH', nome: 'Comprimento', valueType: 'number_unit', allowedUnits: [{ id: 'cm', nome: 'cm' }, { id: 'm', nome: 'm' }] }), // numérico c/ unidade
  A({ id: 'THICKNESS', nome: 'Espessura', valueType: 'number_unit', allowedUnits: [{ id: 'mm', nome: 'mm' }, { id: 'cm', nome: 'cm' }] }),
  A({ id: 'GTIN', nome: 'GTIN', conditionalRequired: true }),
  A({ id: 'COLOR', nome: 'Cor', valueType: 'list', valores: [{ id: '9', nome: 'Preto' }] }), // atributo de variação (IGNORAR)
  A({ id: 'MAIN_COLOR', nome: 'Cor principal', valueType: 'list', valores: [{ id: '9', nome: 'Preto' }], tags: ['variation_attribute'] }), // por variação
  A({ id: 'IMPORT_DUTY', nome: 'Imposto', valueType: 'list', valores: [{ id: '7', nome: '0%' }], tags: ['hidden', 'read_only'] }), // oculto/read-only
  A({ id: 'PRODUCT_FEATURES', nome: 'Características', valueType: 'list', valores: [{ id: '8', nome: 'X' }], tags: ['multivalued', 'read_only'] }), // multivalor
];
const base = [{ id: 'BRAND', value_name: 'Bosch' }, { id: 'MODEL', value_name: 'Furadeira X' }, { id: 'LINE', value_name: 'X' }];
const SEM_FONTE = { nome: '' }; // closed-set/numérico não usam a fonte; texto-livre tem describe próprio

describe('atributosAlvo', () => {
  it('closed-set (obrig. e opcional) + numéricos não preenchidos; ignora GTIN, COLOR (base já tem texto-livre)', () => {
    const alvos = atributosAlvo(SCHEMA, base);
    expect(alvos.map((a) => a.id)).toEqual(['VOLTAGE', 'RIBBON_FORMAT', 'LENGTH', 'THICKNESS']);
    expect(alvos.find((a) => a.id === 'LENGTH')?.unidades).toEqual([{ id: 'cm', nome: 'cm' }, { id: 'm', nome: 'm' }]);
    expect(alvos.find((a) => a.id === 'VOLTAGE')?.tipo).toBe('closed');
    expect(alvos.find((a) => a.id === 'LENGTH')?.tipo).toBe('numero');
  });
  it('inclui texto-livre OBRIGATÓRIO não preenchido, com tipo "texto"', () => {
    const semLinha = [{ id: 'BRAND', value_name: 'Bosch' }, { id: 'MODEL', value_name: 'Furadeira X' }];
    const alvos = atributosAlvo(SCHEMA, semLinha);
    expect(alvos.map((a) => a.id)).toContain('LINE');
    expect(alvos.find((a) => a.id === 'LINE')?.tipo).toBe('texto');
  });
  it('texto-livre OPCIONAL não é alvo (evita poluição/invenção)', () => {
    const schema = [A({ id: 'NOTE', nome: 'Observação', required: false })];
    expect(atributosAlvo(schema, []).map((a) => a.id)).toEqual([]);
  });
  it('exclui variation_attribute, hidden/read_only e multivalued', () => {
    const ids = atributosAlvo(SCHEMA, base).map((a) => a.id);
    expect(ids).not.toContain('MAIN_COLOR');
    expect(ids).not.toContain('IMPORT_DUTY');
    expect(ids).not.toContain('PRODUCT_FEATURES');
  });
  it('atributo já preenchido → não é alvo', () => {
    const r = atributosAlvo(SCHEMA, [...base, { id: 'VOLTAGE', value_id: '3' }, { id: 'RIBBON_FORMAT', value_id: '5' }, { id: 'LENGTH', value_name: '10 cm' }, { id: 'THICKNESS', value_name: '2 mm' }]);
    expect(r).toEqual([]);
  });
});

describe('validarRespostaAtributos (closed-set)', () => {
  const alvos = atributosAlvo(SCHEMA, base);
  it('value_id válido entra', () => {
    expect(validarRespostaAtributos({ VOLTAGE: '3' }, alvos, SEM_FONTE)).toContainEqual({ id: 'VOLTAGE', value_id: '3' });
  });
  it('casa por value_name (fuzzy) normalizado', () => {
    expect(validarRespostaAtributos({ RIBBON_FORMAT: 'rolo' }, alvos, SEM_FONTE)).toContainEqual({ id: 'RIBBON_FORMAT', value_id: '5' });
  });
  it('valor fora da lista → omitido', () => {
    expect(validarRespostaAtributos({ VOLTAGE: '380V' }, alvos, SEM_FONTE)).toEqual([]);
  });
  it('vazio → []', () => {
    expect(validarRespostaAtributos({}, alvos, SEM_FONTE)).toEqual([]);
  });
});

describe('validarRespostaAtributos (numérico)', () => {
  const alvos = atributosAlvo(SCHEMA, base);
  it('número + unidade permitida → value_name', () => {
    expect(validarRespostaAtributos({ LENGTH: '2500 cm' }, alvos, SEM_FONTE)).toContainEqual({ id: 'LENGTH', value_name: '2500 cm' });
  });
  it('aceita vírgula decimal e normaliza', () => {
    expect(validarRespostaAtributos({ LENGTH: '2,5 m' }, alvos, SEM_FONTE)).toContainEqual({ id: 'LENGTH', value_name: '2.5 m' });
  });
  it('unidade fora da lista → omitido (não chuta unidade)', () => {
    expect(validarRespostaAtributos({ LENGTH: '10 polegadas' }, alvos, SEM_FONTE)).toEqual([]);
  });
  it('sem unidade num number_unit → omitido', () => {
    expect(validarRespostaAtributos({ LENGTH: '10' }, alvos, SEM_FONTE)).toEqual([]);
  });
  it('não-número → omitido', () => {
    expect(validarRespostaAtributos({ LENGTH: 'grande' }, alvos, SEM_FONTE)).toEqual([]);
  });
  it('unidade permitida vazia ("") + número sem unidade → omitido (não vira "2500 ")', () => {
    const alvoUnidVazia = atributosAlvo([A({ id: 'LEN2', valueType: 'number_unit', allowedUnits: [{ id: '', nome: '' }, { id: 'cm', nome: 'cm' }] })], []);
    expect(validarRespostaAtributos({ LEN2: '2500' }, alvoUnidVazia, SEM_FONTE)).toEqual([]);
    expect(validarRespostaAtributos({ LEN2: '2500 cm' }, alvoUnidVazia, SEM_FONTE)).toEqual([{ id: 'LEN2', value_name: '2500 cm' }]);
  });
});

describe('validarRespostaAtributos (texto-livre, anti-invenção)', () => {
  const schema = [A({ id: 'LINE', nome: 'Linha', required: true })];
  const alvos = atributosAlvo(schema, []);
  const input = { nome: 'Barbante Bandeirante Cores', descricao: 'linha Anne para crochê' };
  it('aceita texto que consta no nome/descrição (normalizado)', () => {
    expect(validarRespostaAtributos({ LINE: 'Anne' }, alvos, input)).toEqual([{ id: 'LINE', value_name: 'Anne' }]);
  });
  it('rejeita texto que NÃO consta na fonte (invenção)', () => {
    expect(validarRespostaAtributos({ LINE: 'Círculo' }, alvos, input)).toEqual([]);
  });
  it('rejeita texto absurdamente longo', () => {
    const longo = 'x'.repeat(80);
    expect(validarRespostaAtributos({ LINE: longo }, alvos, { nome: longo })).toEqual([]);
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
  it('texto-livre: pede para copiar do título/descrição e não inventar', () => {
    const alvos = atributosAlvo([A({ id: 'LINE', nome: 'Linha', required: true })], []);
    const p = montarPromptAtributos({ nome: 'Barbante Anne' }, alvos);
    expect(p).toContain('LINE');
    expect(p.toLowerCase()).toMatch(/copie|extraia/);
    expect(p.toLowerCase()).toMatch(/n[aã]o.*invent/);
  });
});

describe('preencherAtributosClosedSet', () => {
  const cheio = [...base, { id: 'VOLTAGE', value_id: '1' }, { id: 'RIBBON_FORMAT', value_id: '5' }, { id: 'LENGTH', value_name: '10 cm' }, { id: 'THICKNESS', value_name: '2 mm' }];
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
  it('preenche espessura óbvia em mm sem depender da IA', async () => {
    let alvosIa: string[] = [];
    const r = await preencherAtributosClosedSet(SCHEMA, base, { nome: 'FIO DE MALHA EXTRA PREMIUM 25MM CORES' }, async (_input, alvos) => {
      alvosIa = alvos.map((a) => a.id);
      return {};
    });

    expect(r).toContainEqual({ id: 'THICKNESS', value_name: '25 mm' });
    expect(alvosIa).not.toContain('THICKNESS');
  });
  it('IA falha → base (resiliente)', async () => {
    const r = await preencherAtributosClosedSet(SCHEMA, base, { nome: 'X' }, async () => { throw new Error('rede'); });
    expect(r).toEqual(base);
  });
  it('IA devolve valor inválido → base (omitido)', async () => {
    const r = await preencherAtributosClosedSet(SCHEMA, base, { nome: 'X' }, async () => ({ VOLTAGE: '380V', LENGTH: '10 polegadas' }));
    expect(r).toEqual(base);
  });
  it('texto-livre: preenche quando a IA responde valor que consta no nome', async () => {
    const schema = [A({ id: 'LINE', nome: 'Linha', required: true })];
    const r = await preencherAtributosClosedSet(schema, [], { nome: 'Barbante Anne 400g' }, async () => ({ LINE: 'Anne' }));
    expect(r).toContainEqual({ id: 'LINE', value_name: 'Anne' });
  });
  it('texto-livre: não preenche valor inventado (fora do texto)', async () => {
    const schema = [A({ id: 'LINE', nome: 'Linha', required: true })];
    const r = await preencherAtributosClosedSet(schema, [], { nome: 'Barbante Anne 400g' }, async () => ({ LINE: 'Marca Fantasma' }));
    expect(r).toEqual([]);
  });
});
