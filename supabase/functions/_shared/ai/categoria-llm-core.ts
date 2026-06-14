import type { CategoriaCandidata } from '../ml/domain-discovery.ts';
import type { InputCategoria } from '../categoria/resolver.ts';

// Partes puras do desempate de categoria (sem o cliente OpenAI), p/ serem testáveis sem rede
// — mesmo padrão de copywriter-prompt.ts vs copywriter.ts.

/** Guard: devolve o id só se estiver no closed-set de candidatos; senão null (nunca inventa). */
export function escolherCandidatoValido(
  respostaId: string | null | undefined,
  candidatos: CategoriaCandidata[],
): string | null {
  if (!respostaId) return null;
  return candidatos.some((c) => c.categoriaId === respostaId) ? respostaId : null;
}

/** Prompt do desempate: lista "category_id — domínio > categoria". */
export function montarPromptDesempate(input: InputCategoria, candidatos: CategoriaCandidata[]): string {
  const lista = candidatos
    .map((c, i) => `${i + 1}. ${c.categoriaId} — ${c.domainName} > ${c.categoriaNome}`)
    .join('\n');
  return [
    `Produto: ${input.nome}`,
    input.descricao ? `Descrição: ${input.descricao}` : '',
    '',
    'Categorias candidatas:',
    lista,
    '',
    'Escolha a que melhor descreve o produto. Responda APENAS com o category_id exato da lista.',
  ].filter(Boolean).join('\n');
}

export const SCHEMA_DESEMPATE = {
  name: 'categoria_escolhida',
  schema: {
    type: 'object',
    properties: { category_id: { type: 'string' } },
    required: ['category_id'],
    additionalProperties: false,
  },
  strict: true,
} as const;
