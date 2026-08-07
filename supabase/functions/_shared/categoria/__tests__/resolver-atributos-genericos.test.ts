import { describe, it, expect, vi } from 'vitest';
import { resolverAtributosGenericos } from '../resolver-atributos-genericos';
import type { AtributoSchema } from '../schema';

const A = (o: Partial<AtributoSchema> & { id: string }): AtributoSchema => ({
  nome: o.id, required: false, conditionalRequired: false, valueType: 'string', valores: [], allowedUnits: [], tags: [], ...o,
});
const SCHEMA: AtributoSchema[] = [
  A({ id: 'BRAND', nome: 'Marca', required: true }),
  A({ id: 'MODEL', nome: 'Modelo', required: true }),
  A({ id: 'VOLTAGE', nome: 'Voltagem', conditionalRequired: true, valueType: 'list', valores: [{ id: '1', nome: '110V' }] }),
];

describe('resolverAtributosGenericos', () => {
  it('monta base + fecha closed-set pela IA + calcula faltantes', async () => {
    const llm = vi.fn().mockResolvedValue({ VOLTAGE: '1' });
    const r = await resolverAtributosGenericos(
      'MLB189007',
      { nome: 'Furadeira X 650W', descricao: undefined, fornecedor: 'Bosch' },
      { lerSchema: async () => SCHEMA, llm },
    );
    expect(r.atributosMl).toEqual(expect.arrayContaining([
      { id: 'BRAND', value_name: 'Bosch' },
      { id: 'MODEL', value_name: 'Furadeira X 650W' },
      { id: 'VOLTAGE', value_id: '1' },
    ]));
    expect(r.faltantes).toEqual([]);
  });

  it('categoria com NAME obrigatório (Cuidado Facial MLB264874, lote #11) publica sem intervenção', async () => {
    // NAME é texto-livre: a IA omite quando o nome da linha não consta literalmente no texto
    // (regra de ouro ADR-0052) e a família travava na Revisão pedindo "Nome" ao operador.
    const schemaCosmetico: AtributoSchema[] = [
      A({ id: 'BRAND', nome: 'Marca', required: true }),
      A({ id: 'NAME', nome: 'Nome', required: true, valores: [{ id: '6127976', nome: 'Clarité' }] }),
    ];
    const r = await resolverAtributosGenericos(
      'MLB264874',
      { nome: 'Gel de Limpeza Facial Principia 350g', fornecedor: 'Principia' },
      { lerSchema: async () => schemaCosmetico, llm: async () => ({}) },
    );
    expect(r.atributosMl).toEqual(expect.arrayContaining([
      { id: 'BRAND', value_name: 'Principia' },
      { id: 'NAME', value_name: 'Gel de Limpeza Facial Principia 350g' },
    ]));
    expect(r.faltantes).toEqual([]);
  });

  it('schema vazio → faltante-sentinela (bloqueio seguro, ADR-0051)', async () => {
    const r = await resolverAtributosGenericos(
      'MLB000000',
      { nome: 'Produto qualquer' },
      { lerSchema: async () => [], llm: async () => ({}) },
    );
    expect(r.atributosMl).toEqual([]);
    expect(r.faltantes).toEqual(['atributos da categoria (não validados — revise)']);
  });

  it('lerSchema lança (sem token/rede) → faltante-sentinela, não propaga o erro', async () => {
    const r = await resolverAtributosGenericos(
      'MLB189007',
      { nome: 'Furadeira X' },
      { lerSchema: async () => { throw new Error('sem token'); }, llm: async () => ({}) },
    );
    expect(r.faltantes).toEqual(['atributos da categoria (não validados — revise)']);
  });
});
