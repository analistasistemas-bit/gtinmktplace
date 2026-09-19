import { describe, it, expect } from 'vitest';
import { montarAtributosBase, atributosFaltantesGenerico, rotuloParaTipo } from '../atributos';
import type { AtributoSchema } from '../schema';

const A = (o: Partial<AtributoSchema> & { id: string }): AtributoSchema => ({
  nome: o.id, required: false, conditionalRequired: false, valueType: 'string', valores: [], allowedUnits: [], tags: [], ...o,
});
const SCHEMA: AtributoSchema[] = [
  A({ id: 'BRAND', nome: 'Marca', required: true }),
  A({ id: 'MODEL', nome: 'Modelo', required: true }),
  A({ id: 'VOLTAGE', nome: 'Voltagem', conditionalRequired: true, valueType: 'list', valores: [{ id: '1', nome: '110V' }] }),
  A({ id: 'GTIN', nome: 'Código universal', conditionalRequired: true }),
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
    const a = montarAtributosBase([A({ id: 'BRAND', nome: 'Marca', required: true })], 'Caneta', '');
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
  it('ignora COLOR obrigatório (resolvido por variação, não falso-faltante no SaaS)', () => {
    const schemaComCor: AtributoSchema[] = [
      A({ id: 'BRAND', nome: 'Marca', required: true }),
      A({ id: 'COLOR', nome: 'Cor', required: true }),
    ];
    const tem = [{ id: 'BRAND', value_name: 'X' }]; // COLOR nunca é montado na família
    expect(atributosFaltantesGenerico(tem, schemaComCor)).toEqual([]);
  });

  // ADR-0167 / achado do checkpoint Fable: em categoria de roupa/calçado (ex. MLB108803), SIZE e
  // GENDER são `required` no schema real do ML mas NUNCA entram em `atributos_ml` — SIZE vem de
  // `variacoes.tamanho` (por SKU) e GENDER de `familias.genero`, os dois injetados só na hora de
  // publicar (montarPayloadItem/publicarFamiliaUP), nunca gravados no nível de família. Sem
  // ignorá-los aqui, toda família de roupa/calçado ficaria travada na Revisão como "faltando
  // Tamanho/Gênero" mesmo com os dois já resolvidos — mesmo raciocínio que já vale pra COLOR.
  it('ignora SIZE e GENDER obrigatórios (resolvidos por variação/família, não pelo atributos_ml genérico)', () => {
    const schemaRoupa: AtributoSchema[] = [
      A({ id: 'BRAND', nome: 'Marca', required: true }),
      A({ id: 'SIZE', nome: 'Tamanho', required: true }),
      A({ id: 'GENDER', nome: 'Gênero', required: true }),
    ];
    const tem = [{ id: 'BRAND', value_name: 'X' }];
    expect(atributosFaltantesGenerico(tem, schemaRoupa)).toEqual([]);
  });
});
