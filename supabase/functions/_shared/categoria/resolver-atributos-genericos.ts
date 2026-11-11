import type { AtributoSchema } from './schema.ts';
import {
  montarAtributosBase,
  atributosFaltantesGenerico,
  faltanteKitSemContagem,
  preencherUnitsPerPack,
  preencherNomeObrigatorio,
  FALTANTE_ATRIBUTOS_NAO_VALIDADOS,
  type AtributoML,
} from './atributos.ts';
import {
  alvosVisuais,
  atributosAlvo,
  preencherAtributosClosedSet,
  validarRespostaAtributos,
  type AtributoAlvo,
  type InputAtributos,
} from '../ai/atributos-llm-core.ts';

export interface InputAtributosGenericos {
  nome: string;
  descricao?: string;
  fornecedor?: string;
}

export interface DepsAtributosGenericos {
  lerSchema: (categoriaId: string) => Promise<AtributoSchema[]>;
  llm: (input: InputAtributos, alvos: AtributoAlvo[]) => Promise<Record<string, string>>;
  /** ADR-0202: atributos visuais pela foto (só os que o texto deixou vazios). Ausente → só texto. */
  visao?: (alvos: AtributoAlvo[]) => Promise<Record<string, string>>;
}

/** Atributo preenchido pela foto — a Revisão mostra "confira" com os valores para corrigir. */
export interface AtributoPorFoto {
  id: string;
  nome: string;
  valores: { id: string; nome: string }[];
}

export interface ResultadoAtributosGenericos {
  atributosMl: AtributoML[];
  faltantes: string[];
  porFoto: AtributoPorFoto[];
}

/** Etapa isolada: qualquer falha devolve o que já havia (texto nunca se perde por causa da foto). */
async function preencherPelaFoto(
  schema: AtributoSchema[],
  atual: AtributoML[],
  input: InputAtributos,
  visao: NonNullable<DepsAtributosGenericos['visao']>,
): Promise<{ atributosMl: AtributoML[]; porFoto: AtributoPorFoto[] }> {
  try {
    const alvos = alvosVisuais(atributosAlvo(schema, atual));
    if (alvos.length === 0) return { atributosMl: atual, porFoto: [] };
    const aceitos = validarRespostaAtributos(await visao(alvos), alvos, input);
    const porFoto = alvos
      .filter((a) => aceitos.some((x) => x.id === a.id))
      .map((a) => ({ id: a.id, nome: a.nome, valores: a.valores }));
    return { atributosMl: [...atual, ...aceitos], porFoto };
  } catch (e) {
    console.error('atributos pela foto falharam:', e);
    return { atributosMl: atual, porFoto: [] };
  }
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
    let porFoto: AtributoPorFoto[] = [];
    if (deps.visao) {
      ({ atributosMl, porFoto } = await preencherPelaFoto(
        schema, atributosMl, { nome: input.nome, descricao: input.descricao }, deps.visao,
      ));
    }
    atributosMl = preencherUnitsPerPack(schema, atributosMl, input.nome, input.descricao);
    atributosMl = preencherNomeObrigatorio(schema, atributosMl, input.nome);
    const faltantes = [...new Set([
      ...atributosFaltantesGenerico(atributosMl, schema),
      ...faltanteKitSemContagem(schema, atributosMl),
    ])];
    return { atributosMl, faltantes, porFoto };
  } catch (e) {
    console.error('resolverAtributosGenericos falhou:', e);
    return { atributosMl: [], faltantes: [FALTANTE_ATRIBUTOS_NAO_VALIDADOS], porFoto: [] };
  }
}
