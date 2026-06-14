import type { AtributoSchema } from '../categoria/schema.ts';
import type { AtributoML } from '../categoria/atributos.ts';

// Partes puras do preenchimento de atributos por IA (closed-set), testáveis sem rede (ADR-0026 / E4).
// A IA só escolhe DENTRO de values[] da categoria; nunca inventa.

export interface AtributoAlvo {
  id: string;
  nome: string;
  valores: { id: string; nome: string }[];
}
export interface InputAtributos {
  nome: string;
  descricao?: string;
}

// GTIN/EMPTY_GTIN_REASON são resolvidos por variação na publicação, não pela IA.
const IGNORAR = new Set(['GTIN', 'EMPTY_GTIN_REASON']);

function normalizar(s: string): string {
  return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/** Atributos que a IA deve preencher: obrigatórios com closed-set (values[]) ainda não preenchidos. */
export function atributosAlvo(schema: AtributoSchema[], jaPreenchidos: AtributoML[]): AtributoAlvo[] {
  const presentes = new Set(jaPreenchidos.filter((a) => a.value_name || a.value_id).map((a) => a.id));
  return schema
    .filter((a) =>
      (a.required || a.conditionalRequired) &&
      a.valores.length > 0 &&
      !IGNORAR.has(a.id) &&
      !presentes.has(a.id),
    )
    .map((a) => ({ id: a.id, nome: a.nome, valores: a.valores }));
}

/**
 * Valida a resposta da IA contra o closed-set. Para cada alvo, aceita o valor só se casar com um
 * value_id (exato) ou value_name (normalizado) da lista; senão omite (nunca inventa).
 */
export function validarRespostaAtributos(
  resp: Record<string, string>,
  alvos: AtributoAlvo[],
): AtributoML[] {
  const out: AtributoML[] = [];
  for (const alvo of alvos) {
    const bruto = resp?.[alvo.id];
    if (!bruto) continue;
    const porId = alvo.valores.find((v) => v.id === bruto);
    const porNome = porId ? null : alvo.valores.find((v) => normalizar(v.nome) === normalizar(bruto));
    const escolhido = porId ?? porNome;
    if (escolhido) out.push({ id: alvo.id, value_id: escolhido.id });
  }
  return out;
}

/**
 * Preenche os atributos obrigatórios closed-set ainda vazios (ADR-0026 / E4). Não chama a IA quando
 * não há alvo. Closed-set + resiliente: valor fora da lista ou IA falha → atributo fica faltante.
 */
export async function preencherAtributosClosedSet(
  schema: AtributoSchema[],
  base: AtributoML[],
  input: InputAtributos,
  llm: (input: InputAtributos, alvos: AtributoAlvo[]) => Promise<Record<string, string>>,
): Promise<AtributoML[]> {
  const alvos = atributosAlvo(schema, base);
  if (alvos.length === 0) return base;
  const resp = await llm(input, alvos).catch(() => ({} as Record<string, string>));
  const preenchidos = validarRespostaAtributos(resp, alvos);
  return [...base, ...preenchidos];
}

/** Prompt: para cada atributo, a lista de valores permitidos (value_id — nome). */
export function montarPromptAtributos(input: InputAtributos, alvos: AtributoAlvo[]): string {
  const blocos = alvos.map((a) => {
    const vals = a.valores.slice(0, 60).map((v) => `${v.id} = ${v.nome}`).join('; ');
    return `- ${a.id} (${a.nome}): ${vals}`;
  }).join('\n');
  return [
    `Produto: ${input.nome}`,
    input.descricao ? `Descrição: ${input.descricao}` : '',
    '',
    'Para cada atributo abaixo, escolha o value_id que melhor descreve o produto, SOMENTE se a informação',
    'estiver clara no título/descrição. Se não souber, NÃO inclua o atributo. Nunca invente.',
    '',
    blocos,
    '',
    'Responda um JSON { "ATRIBUTO_ID": "value_id", ... } só com os que tiver certeza.',
  ].filter(Boolean).join('\n');
}
