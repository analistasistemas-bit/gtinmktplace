import { redisGet, redisSet } from '../redis/client.ts';

// Schema dinâmico de atributos por categoria (ADR-0026 / E3). Lido de GET
// /categories/{id}/attributes e cacheado. Shape validado com token real (probe 2026-06-14):
// {id, name, tags:{required, conditional_required, catalog_required,…}, values:[{id,name}]}.
// value_type da API ML: 'list'/'boolean' têm values[]; 'number'/'number_unit' são numéricos
// (sem closed-set); 'string' é texto livre. allowed_units só vem em 'number_unit' (ex.: cm, m).
export type ValueType = 'string' | 'number' | 'number_unit' | 'list' | 'boolean';

export interface AtributoSchema {
  id: string;
  nome: string;
  required: boolean;
  conditionalRequired: boolean;
  valueType: ValueType;
  valores: { id: string; nome: string }[];
  allowedUnits: { id: string; nome: string }[];
  tags: string[]; // nomes das tags `true` (ex.: hidden, read_only, variation_attribute, multivalued)
}

export function parseAtributosSchema(body: unknown): AtributoSchema[] {
  if (!Array.isArray(body)) return [];
  const parseLista = (arr: unknown[]) => arr
    .filter((v): v is Record<string, string> => !!v && typeof (v as { id?: unknown }).id === 'string')
    .map((v) => ({ id: v.id, nome: String(v.name ?? v.id) }));
  return body
    .filter((a): a is Record<string, unknown> => !!a && typeof (a as { id?: unknown }).id === 'string')
    .map((a) => {
      const tags = (a.tags ?? {}) as Record<string, boolean>;
      return {
        id: a.id as string,
        nome: String(a.name ?? a.id),
        required: tags.required === true,
        conditionalRequired: tags.conditional_required === true,
        valueType: (typeof a.value_type === 'string' ? a.value_type : 'string') as ValueType,
        valores: parseLista(Array.isArray(a.values) ? a.values : []),
        allowedUnits: parseLista(Array.isArray(a.allowed_units) ? a.allowed_units : []),
        tags: Object.keys(tags).filter((k) => tags[k] === true),
      };
    });
}

/** IDs dos atributos obrigatórios (required + conditional_required) da categoria. */
export function idsObrigatorios(schema: AtributoSchema[]): string[] {
  return schema.filter((a) => a.required || a.conditionalRequired).map((a) => a.id);
}

/** Nomes humanos dos atributos obrigatórios (para exibir na Revisão). */
export function nomesObrigatorios(schema: AtributoSchema[]): string[] {
  return schema.filter((a) => a.required || a.conditionalRequired).map((a) => a.nome);
}

const TTL_S = 30 * 24 * 60 * 60;

// Versão do shape do schema cacheado. Bumpar quando parseAtributosSchema mudar de forma
// (ex.: v2 = valueType/allowedUnits/tags, commit 047f3ae) — entradas do shape antigo ficam
// órfãs e expiram sozinhas, em vez de serem lidas e estourarem TypeError em atributosAlvo.
const CACHE_VER = 'v2';

/** Id de categoria do ML: 'MLB' + dígitos, nada mais. Vale como guard de SSRF — o valor é
 *  interpolado num caminho de URL de uma requisição que leva o token do vendedor, e o parser
 *  de URL resolve '..' antes de enviar, então qualquer coisa fora deste formato poderia
 *  redirecionar a chamada autenticada para outro endpoint da api.mercadolibre.com. */
export function ehCategoriaMlValida(categoriaId: string | null | undefined): boolean {
  return !!categoriaId && /^MLB\d+$/.test(categoriaId);
}

/** Lê o schema de atributos da categoria. Resiliente: rede/4xx → []. Cacheado no Redis. */
export async function lerSchemaAtributos(token: string, categoriaId: string): Promise<AtributoSchema[]> {
  // Guard em profundidade: o chamador já valida, mas esta é a função que monta a URL.
  if (!ehCategoriaMlValida(categoriaId)) return [];
  const key = `attrs:${CACHE_VER}:${categoriaId}`;
  const cached = await redisGet(key).catch(() => null);
  if (cached) return JSON.parse(cached) as AtributoSchema[];

  const r = await fetch(`https://api.mercadolibre.com/categories/${categoriaId}/attributes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return [];
  const schema = parseAtributosSchema(await r.json().catch(() => null));
  await redisSet(key, JSON.stringify(schema), TTL_S).catch(() => {});
  return schema;
}
