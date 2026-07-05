import type { AtributoSchema } from './schema.ts';
import {
  montarAtributosBase,
  atributosFaltantesGenerico,
  preencherUnitsPerPack,
  FALTANTE_ATRIBUTOS_NAO_VALIDADOS,
  type AtributoML,
} from './atributos.ts';
import { preencherAtributosClosedSet, type AtributoAlvo, type InputAtributos } from '../ai/atributos-llm-core.ts';

export interface InputAtributosGenericos {
  nome: string;
  descricao?: string;
  fornecedor?: string;
}

export interface DepsAtributosGenericos {
  lerSchema: (categoriaId: string) => Promise<AtributoSchema[]>;
  llm: (input: InputAtributos, alvos: AtributoAlvo[]) => Promise<Record<string, string>>;
}

export interface ResultadoAtributosGenericos {
  atributosMl: AtributoML[];
  faltantes: string[];
}

/**
 * Categoria genérica (não-aviamento): valida obrigatórios contra o schema real da API (E3/E4).
 * Regra de ouro do SaaS (ADR-0051): se não der para validar (schema indisponível/vazio/erro), não
 * publica às cegas — devolve faltante-sentinela p/ travar na Revisão. Extraído de process-familia
 * p/ ser reusado também pelo seletor manual de categoria livre (ADR-0057), sem duplicar lógica.
 */
export async function resolverAtributosGenericos(
  categoriaMlId: string,
  input: InputAtributosGenericos,
  deps: DepsAtributosGenericos,
  marcaPadrao?: string,
): Promise<ResultadoAtributosGenericos> {
  try {
    const schema = await deps.lerSchema(categoriaMlId);
    if (!schema || schema.length === 0) throw new Error('schema vazio da categoria');
    const base = montarAtributosBase(schema, input.nome, input.fornecedor, marcaPadrao);
    let atributosMl = await preencherAtributosClosedSet(
      schema, base, { nome: input.nome, descricao: input.descricao }, deps.llm,
    );
    atributosMl = preencherUnitsPerPack(schema, atributosMl, input.nome, input.descricao);
    const faltantes = atributosFaltantesGenerico(atributosMl, schema);
    return { atributosMl, faltantes };
  } catch (e) {
    console.error('resolverAtributosGenericos falhou:', e);
    return { atributosMl: [], faltantes: [FALTANTE_ATRIBUTOS_NAO_VALIDADOS] };
  }
}
