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

/**
 * Detecta abstenção deliberada do LLM ("nenhum candidato serve"). Achado empírico (2026-07-02,
 * chamadas reais contra gpt-4o-mini via OpenRouter com SCHEMA_DESEMPATE): o modelo devolve a
 * STRING "null" em vez do literal JSON null, mesmo em modo strict com type:['string','null'].
 * Trata os dois como a mesma coisa — não pode ser confundido com falha técnica (ver
 * categoria-llm.ts: abstenção → resolver cai em manual; falha técnica → cai no topo).
 */
export function ehAbstencaoDeliberada(categoryId: string | null | undefined): boolean {
  if (categoryId === null) return true;
  return typeof categoryId === 'string' && categoryId.trim().toLowerCase() === 'null';
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
    'Se NENHUMA categoria da lista descrever de fato este produto, responda category_id null — mesmo que exista só uma opção na lista. Não escolha a menos pior só por ser a única disponível.',
  ].filter(Boolean).join('\n');
}

export const SCHEMA_DESEMPATE = {
  name: 'categoria_escolhida',
  schema: {
    type: 'object',
    properties: { category_id: { type: ['string', 'null'] } },
    required: ['category_id'],
    additionalProperties: false,
  },
  strict: true,
} as const;
