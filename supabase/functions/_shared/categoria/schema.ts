import { redisGet, redisSet } from '../redis/client.ts';

// Schema dinâmico de atributos por categoria (ADR-0026 / E3). Lido de GET
// /categories/{id}/attributes e cacheado. Shape validado com token real (probe 2026-06-14):
// {id, name, tags:{required, conditional_required, catalog_required,…}, values:[{id,name}]}.
export interface AtributoSchema {
  id: string;
  nome: string;
  required: boolean;
  conditionalRequired: boolean;
  valores: { id: string; nome: string }[];
}

export function parseAtributosSchema(body: unknown): AtributoSchema[] {
  if (!Array.isArray(body)) return [];
  return body
    .filter((a): a is Record<string, unknown> => !!a && typeof (a as { id?: unknown }).id === 'string')
    .map((a) => {
      const tags = (a.tags ?? {}) as Record<string, boolean>;
      const values = Array.isArray(a.values) ? a.values : [];
      return {
        id: a.id as string,
        nome: String(a.name ?? a.id),
        required: tags.required === true,
        conditionalRequired: tags.conditional_required === true,
        valores: values
          .filter((v): v is Record<string, string> => !!v && typeof (v as { id?: unknown }).id === 'string')
          .map((v) => ({ id: v.id, nome: String(v.name ?? v.id) })),
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

/** Lê o schema de atributos da categoria. Resiliente: rede/4xx → []. Cacheado no Redis. */
export async function lerSchemaAtributos(token: string, categoriaId: string): Promise<AtributoSchema[]> {
  if (!categoriaId) return [];
  const key = `attrs:${categoriaId}`;
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
