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
const SEM_FONTE = { nome: '' }; // closed-set não usa a fonte; numérico/texto-livre têm describe próprio

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
  it('schema de shape antigo (sem tags, de cache stale) não estoura — degrada, não derruba o enriquecimento', () => {
    // Regressão: cache Redis do shape pré-047f3ae (sem tags/valueType/allowedUnits) fazia
    // a.tags.some(...) estourar TypeError, engolido pelo try/catch em process-familia → item
    // ficava só com atributos determinísticos (WIDTH/LENGTH nunca preenchidos nas fitas).
    const stale = [{ id: 'LENGTH', nome: 'Comprimento', required: false, conditionalRequired: false, valores: [] }] as unknown as AtributoSchema[];
    expect(() => atributosAlvo(stale, [])).not.toThrow();
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
  const comFonte = { nome: 'Fita 2500 cm com 2,5 m de sobra' };
  it('número + unidade permitida, e grounded no texto → value_name', () => {
    expect(validarRespostaAtributos({ LENGTH: '2500 cm' }, alvos, comFonte)).toContainEqual({ id: 'LENGTH', value_name: '2500 cm' });
  });
  it('aceita vírgula decimal e normaliza', () => {
    expect(validarRespostaAtributos({ LENGTH: '2,5 m' }, alvos, comFonte)).toContainEqual({ id: 'LENGTH', value_name: '2.5 m' });
  });
  it('unidade fora da lista → omitido (não chuta unidade)', () => {
    expect(validarRespostaAtributos({ LENGTH: '10 polegadas' }, alvos, comFonte)).toEqual([]);
  });
  it('sem unidade num number_unit → omitido', () => {
    expect(validarRespostaAtributos({ LENGTH: '10' }, alvos, comFonte)).toEqual([]);
  });
  it('não-número → omitido', () => {
    expect(validarRespostaAtributos({ LENGTH: 'grande' }, alvos, comFonte)).toEqual([]);
  });
  it('unidade permitida vazia ("") + número sem unidade → omitido (não vira "2500 ")', () => {
    const alvoUnidVazia = atributosAlvo([A({ id: 'LEN2', valueType: 'number_unit', allowedUnits: [{ id: '', nome: '' }, { id: 'cm', nome: 'cm' }] })], []);
    expect(validarRespostaAtributos({ LEN2: '2500' }, alvoUnidVazia, comFonte)).toEqual([]);
    expect(validarRespostaAtributos({ LEN2: '2500 cm' }, alvoUnidVazia, comFonte)).toEqual([{ id: 'LEN2', value_name: '2500 cm' }]);
  });
  it('rejeita número que NÃO consta no texto (invenção — bug real: WEIGHT 120g "chutado" p/ produto sem peso no título/descrição)', () => {
    const semPeso = { nome: 'Tecido Helanca Light Lycra Tensionada 3,00 X 1,80 Metros' };
    expect(validarRespostaAtributos({ LENGTH: '120 cm' }, alvos, semPeso)).toEqual([]);
  });
  it('número correto em formato diferente da fonte ainda é aceito (mesmo valor, vírgula vs ponto)', () => {
    const inp = { nome: 'Tecido 3,00 X 1,80 Metros' };
    expect(validarRespostaAtributos({ LENGTH: '3 m' }, alvos, inp)).toEqual([{ id: 'LENGTH', value_name: '3 m' }]);
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
  it('rejeita fragmento de palavra (não é token da fonte)', () => {
    // "and" ⊂ "Bandeirante" no texto, mas não é palavra inteira → rejeitado
    expect(validarRespostaAtributos({ LINE: 'and' }, alvos, input)).toEqual([]);
  });
  it('rejeita valor de 1 caractere (piso)', () => {
    expect(validarRespostaAtributos({ LINE: 'a' }, alvos, input)).toEqual([]);
  });
  it('rejeita multi-palavra que não aparece em sequência contígua', () => {
    expect(validarRespostaAtributos({ LINE: 'Anne Bandeirante' }, alvos, input)).toEqual([]);
  });
  it('aceita valor multi-palavra contíguo na fonte', () => {
    const inp = { nome: 'Linha Anne Cores', descricao: '' };
    expect(validarRespostaAtributos({ LINE: 'Anne Cores' }, alvos, inp)).toEqual([{ id: 'LINE', value_name: 'Anne Cores' }]);
  });
});

// value_type=string com valores SUGERIDOS (ex.: MATERIAL de Pingentes: Alpaca/Ouro/Prata/Vidro).
// No ML, value_type=string é texto-livre; os valores são sugestão, não lista fechada (value_type=list).
// Deve ser tratado como texto-livre (regra de ouro ADR-0052), não como closed-set estrito.
describe('value_type=string obrigatório com valores sugeridos (MATERIAL)', () => {
  const MATERIAL = A({
    id: 'MATERIAL', nome: 'Material', required: true, valueType: 'string',
    valores: [{ id: '1', nome: 'Alpaca' }, { id: '2', nome: 'Ouro' }, { id: '3', nome: 'Prata' }, { id: '4', nome: 'Vidro' }],
  });
  const alvos = atributosAlvo([MATERIAL], []);
  const input = { nome: 'Pingente Decorativo Búfalo', descricao: 'Fabricado em 100% poliéster de alta qualidade.' };

  it('é classificado como tipo "texto", não "closed"', () => {
    expect(alvos.find((a) => a.id === 'MATERIAL')?.tipo).toBe('texto');
  });
  it('aceita valor de texto-livre fora da lista sugerida se constar na descrição', () => {
    expect(validarRespostaAtributos({ MATERIAL: 'poliéster' }, alvos, input)).toEqual([{ id: 'MATERIAL', value_name: 'poliéster' }]);
  });
  it('aceita valor sugerido da lista quando consta no texto', () => {
    const inp = { nome: 'Pingente de Prata 925', descricao: '' };
    expect(validarRespostaAtributos({ MATERIAL: 'Prata' }, alvos, inp)).toEqual([{ id: 'MATERIAL', value_name: 'Prata' }]);
  });
  it('rejeita material inventado que não consta no texto (não chuta da lista)', () => {
    expect(validarRespostaAtributos({ MATERIAL: 'Ouro' }, alvos, input)).toEqual([]);
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
    const r = await preencherAtributosClosedSet(SCHEMA, base, { nome: 'Fita', descricao: 'rolo 25m' }, async () => ({ RIBBON_FORMAT: '5', LENGTH: '25 m' }));
    expect(r).toContainEqual({ id: 'RIBBON_FORMAT', value_id: '5' });
    expect(r).toContainEqual({ id: 'LENGTH', value_name: '25 m' });
  });
  it('IA "chuta" numérico não grounded no texto → omitido mesmo em formato válido', async () => {
    const r = await preencherAtributosClosedSet(SCHEMA, base, { nome: 'Fita', descricao: 'rolo 25m' }, async () => ({ RIBBON_FORMAT: '5', LENGTH: '2500 cm' }));
    expect(r).toContainEqual({ id: 'RIBBON_FORMAT', value_id: '5' });
    expect(r.find((a) => a.id === 'LENGTH')).toBeUndefined();
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
