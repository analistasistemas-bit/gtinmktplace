import { describe, it, expect } from 'vitest';
import {
  atributosAlvo,
  validarRespostaAtributos,
  montarPromptAtributos,
  preencherAtributosClosedSet,
} from '../atributos-llm-core';
import type { AtributoSchema } from '../../categoria/schema';
import schemaMlb270273Raw from './fixtures/schema-mlb270273.json';
import { parseAtributosSchema } from '../../categoria/schema';

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
  it('exclui variation_attribute, hidden/read_only (multivalued sozinho NÃO exclui mais — adendo ADR-0052 2026-07-30)', () => {
    const ids = atributosAlvo(SCHEMA, base).map((a) => a.id);
    expect(ids).not.toContain('MAIN_COLOR');
    expect(ids).not.toContain('IMPORT_DUTY');
    expect(ids).not.toContain('PRODUCT_FEATURES'); // multivalued + read_only → ainda de fora (read_only)
  });
  it('texto-livre OPCIONAL sem sugestão agora é alvo (cobertura máxima, adendo ADR-0052 2026-07-30)', () => {
    const schema = [A({ id: 'NOTE', nome: 'Observação', required: false })];
    expect(atributosAlvo(schema, []).map((a) => a.id)).toEqual(['NOTE']);
  });
  it('texto-livre OPCIONAL com id regulatório/certificação continua de fora (denylist)', () => {
    const schema = [A({ id: 'ANVISA_REGISTRATION', nome: 'Registro ANVISA', required: false })];
    expect(atributosAlvo(schema, []).map((a) => a.id)).toEqual([]);
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

describe('validarRespostaAtributos (numérico, unidade precisa bater com o contexto do número)', () => {
  const schema = [
    A({ id: 'LENGTH', nome: 'Comprimento', valueType: 'number_unit', allowedUnits: [{ id: 'm', nome: 'm' }, { id: 'cm', nome: 'cm' }] }),
    A({ id: 'UNIT_WEIGHT', nome: 'Peso da unidade', valueType: 'number_unit', allowedUnits: [{ id: 'g', nome: 'g' }, { id: 'kg', nome: 'kg' }] }),
  ];
  const alvos = atributosAlvo(schema, []);

  it('aceita LENGTH=224 m (sinônimo "metros"→"m" bate com o número no texto)', () => {
    const input = { nome: 'Linha 224 metros' };
    expect(validarRespostaAtributos({ LENGTH: '224 m' }, alvos, input)).toEqual([{ id: 'LENGTH', value_name: '224 m' }]);
  });
  it('rejeita UNIT_WEIGHT=224 g quando o 224 do texto só aparece com "metros" (bug real: comprimento confundido com peso)', () => {
    const input = { nome: 'Linha 224 metros' };
    expect(validarRespostaAtributos({ UNIT_WEIGHT: '224 g' }, alvos, input)).toEqual([]);
  });
  it('unidade não reconhecida perto do número (fora da tabela de sinônimos) não bloqueia — sem sinal confiável, mantém o comportamento atual', () => {
    const input = { nome: 'Linha 224 braças' };
    expect(validarRespostaAtributos({ LENGTH: '224 m' }, alvos, input)).toEqual([{ id: 'LENGTH', value_name: '224 m' }]);
  });
  it('quilo/kg também tem sinônimo (grama/quilo cobertos, não só metro)', () => {
    const input = { nome: 'Novelo 100 gramas' };
    expect(validarRespostaAtributos({ UNIT_WEIGHT: '100 g' }, alvos, input)).toEqual([{ id: 'UNIT_WEIGHT', value_name: '100 g' }]);
    expect(validarRespostaAtributos({ LENGTH: '100 m' }, alvos, input)).toEqual([]);
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
  it('casa mesmo com pontuação colada na fonte (bug real: "ALGODÃO." não batia com "algodão")', () => {
    const inp = { nome: 'Linha Renascença', descricao: 'COMPOSIÇÃO: 100% ALGODÃO. USO: CROCHÊ' };
    expect(validarRespostaAtributos({ LINE: 'algodão' }, atributosAlvo(schema, []), inp)).toEqual([{ id: 'LINE', value_name: 'algodão' }]);
  });
  it('NÃO casa contíguo através de pontuação forte (dois itens de lista não viram um valor só)', () => {
    const inp = { nome: 'Linha X', descricao: 'COMPOSIÇÃO: ALGODÃO. POLIÉSTER PREMIUM' };
    expect(validarRespostaAtributos({ LINE: 'Algodão Poliéster' }, atributosAlvo(schema, []), inp)).toEqual([]);
  });
  it('vírgula NÃO é pontuação forte (contiguidade de 2 palavras sobrevive a vírgula, só não a ponto/ponto-e-vírgula/dois-pontos)', () => {
    const inp = { nome: 'Linha X', descricao: 'É a tradicional Renda Renascença, uma das mais belas técnicas' };
    expect(validarRespostaAtributos({ LINE: 'Renda Renascença' }, atributosAlvo(schema, []), inp)).toEqual([{ id: 'LINE', value_name: 'Renda Renascença' }]);
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
  it('reforça para não reciclar o mesmo número em atributos diferentes quando há alvo numérico', () => {
    const p = montarPromptAtributos({ nome: 'Fita', descricao: 'rolo 25m veludo' }, atributosAlvo(SCHEMA, base));
    expect(p.toLowerCase()).toContain('não reutilize o mesmo número');
  });
  it('multivalued: pede só 1 valor, sem juntar por vírgula', () => {
    const schema = [A({ id: 'COMPOSITION', nome: 'Composição', valueType: 'string', tags: ['multivalued'] })];
    const p = montarPromptAtributos({ nome: 'Linha Algodão' }, atributosAlvo(schema, []));
    expect(p.toLowerCase()).toContain('não junte vários separados por vírgula');
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

describe('multivalued vira alvo (cobertura máxima, adendo ADR-0052 2026-07-30)', () => {
  const schema = [A({
    id: 'COMPOSITION', nome: 'Composição', valueType: 'string',
    valores: [{ id: '1', nome: 'Algodão' }, { id: '2', nome: 'Poliéster' }], tags: ['multivalued'],
  })];
  const alvos = atributosAlvo(schema, []);
  it('multivalued sem read_only/hidden vira alvo, com a flag multivalued=true', () => {
    expect(alvos.map((a) => a.id)).toEqual(['COMPOSITION']);
    expect(alvos[0].multivalued).toBe(true);
  });

  const input = { nome: 'Linha Algodão Poliéster 100%' };
  it('aceita 1 valor extraído do texto', () => {
    expect(validarRespostaAtributos({ COMPOSITION: 'Algodão' }, alvos, input)).toEqual([{ id: 'COMPOSITION', value_name: 'Algodão' }]);
  });
  it('resposta com vírgula (tentativa de multi-valor) é rejeitada — fase 1 só sabe 1 valor por atributo', () => {
    expect(validarRespostaAtributos({ COMPOSITION: 'Algodão, Poliéster' }, alvos, input)).toEqual([]);
  });
});

// Guard de regressão da cobertura (adendo ADR-0052, 2026-07-30): schema REAL da categoria
// MLB270273 (Fios e Cadarços) + texto REAL da família c1fb33e4-ec56-489d-b0ff-c7354b3b0444 em
// produção (a que motivou toda essa investigação). Antes deste adendo, só 3 atributos viravam
// alvo pra essa família (LENGTH, THICKNESS, FINISH); depois, 6 (+ LINE, COMPOSITION,
// RECOMMENDED_USES) — os mesmos 3 que ficavam em branco na Revisão comparado ao "Sugerir
// características" nativo do ML.
describe('golden: categoria real MLB270273 — família real da investigação 2026-07-30', () => {
  const schema = parseAtributosSchema(schemaMlb270273Raw);
  // Já preenchido pelo caminho determinístico + closed-set/numérico que já funcionava antes
  // desta mudança — snapshot real da família em produção.
  const jaPreenchidos = [
    { id: 'BRAND', value_name: 'BR17-COATS CORRENTE LTDA' },
    { id: 'MODEL', value_name: 'LINHA ESP. P/RENASCENCA COR BRANCO C/10UND' },
    { id: 'PRESENTATION_TYPE', value_name: 'PACOTE COM 10 NOVELOS' },
    { id: 'UNITS_PER_PACKAGE', value_name: '10' },
    { id: 'UNIT_WEIGHT', value_name: '224 g' },
    { id: 'IS_WAXED', value_id: '242084' },
    { id: 'IS_ELASTIC', value_id: '242084' },
    { id: 'SALE_FORMAT', value_id: '1359392' },
  ];
  const input = {
    nome: 'LINHA ESP. P/RENASCENCA COR BRANCO C/10UND',
    descricao: 'LINHA ESPECIAL PARA RENASCENÇA NA COR BRANCA.TEX 87 ET.140. CONTÉM: PACOTE COM 10 NOVELOS COM 224 METROS CADA. COMPOSIÇÃO: 100% ALGODÃO. A LINHA RENASCENÇA É O FIO IDEAL PARA A CONFECÇÃO DA TRADICIONAL RENDA RENASCENÇA, UMA DAS MAIS BELAS E REFINADAS TÉCNICAS DO ARTESANATO BRASILEIRO. COM EXCELENTE QUALIDADE E ACABAMENTO, ELA PROPORCIONA O CAIMENTO E A FIRMEZA NECESSÁRIOS PARA UNIR OS LACÊS E FORMAR OS DELICADOS DESENHOS CARACTERÍSTICOS DESSA RENDA. SUA RESISTÊNCIA GARANTE QUE AS PEÇAS MANTENHAM A BELEZA E A DURABILIDADE AO LONGO DO TEMPO, MESMO APÓS LAVAGENS. PERFEITA PARA QUEM APRECIA TRABALHOS MANUAIS SOFISTICADOS, A LINHA RENASCENÇA PERMITE CRIAR PEÇAS EXCLUSIVAS COMO TOALHAS, CAMINHOS DE MESA, BLUSAS, VESTIDOS, GOLAS E ITENS DE DECORAÇÃO QUE ENCANTAM PELA ELEGÂNCIA E PELO TRABALHO ARTESANAL MINUCIOSO.',
  };

  it('6 atributos viram alvo (antes do adendo eram só 3: LENGTH/THICKNESS/FINISH)', () => {
    const alvos = atributosAlvo(schema, jaPreenchidos);
    expect(alvos.map((a) => a.id).sort()).toEqual(
      ['COMPOSITION', 'FINISH', 'LENGTH', 'LINE', 'RECOMMENDED_USES', 'THICKNESS'].sort(),
    );
  });

  it('preenche LINE, COMPOSITION, RECOMMENDED_USES e LENGTH com valores literalmente presentes na descrição real (FINISH/THICKNESS ficam de fora — sem info clara no texto, igual ao "Sugerir características" nativo do ML nesse mesmo produto)', () => {
    const respostaIaSimulada = {
      LINE: 'Linha Especial para Renascença',
      COMPOSITION: 'Algodão',
      RECOMMENDED_USES: 'Renda Renascença',
      LENGTH: '224 m',
    };
    const alvos = atributosAlvo(schema, jaPreenchidos);
    const preenchidos = validarRespostaAtributos(respostaIaSimulada, alvos, input);
    expect(preenchidos).toContainEqual({ id: 'LINE', value_name: 'Linha Especial para Renascença' });
    expect(preenchidos).toContainEqual({ id: 'COMPOSITION', value_name: 'Algodão' });
    expect(preenchidos).toContainEqual({ id: 'RECOMMENDED_USES', value_name: 'Renda Renascença' });
    expect(preenchidos).toContainEqual({ id: 'LENGTH', value_name: '224 m' });
  });
});
