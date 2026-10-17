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

// Rótulo do gênero cadastrado (familias.genero, CHECK do ADR-0182) com o público explícito — o
// desempate precisa saber se o produto é adulto ou infantil (ADR-0026 emenda 2026-10-17).
const ROTULO_GENERO: Record<string, string> = {
  masculino: 'Masculino (adulto)',
  feminino: 'Feminino (adulto)',
  unissex: 'Unissex (adulto)',
  meninos: 'Meninos (infantil)',
  meninas: 'Meninas (infantil)',
  sem_genero_infantil: 'Sem gênero infantil (infantil)',
};

/**
 * Prompt do desempate: lista "category_id — caminho completo" quando `caminhos` traz o id
 * (path_from_root, ex. "Bebês > Roupas de Bebê > Shorts"); senão "domínio > categoria". Sem o
 * caminho, categorias-irmãs do mesmo domínio (adulto × bebê) eram indistinguíveis — caso do short
 * MLB188064 → MLB278065 (ADR-0026 emenda 2026-10-17).
 */
export function montarPromptDesempate(
  input: InputCategoria,
  candidatos: CategoriaCandidata[],
  caminhos: Record<string, string> = {},
): string {
  const lista = candidatos
    .map((c, i) => `${i + 1}. ${c.categoriaId} — ${caminhos[c.categoriaId] ?? `${c.domainName} > ${c.categoriaNome}`}`)
    .join('\n');
  const genero = input.genero ? ROTULO_GENERO[input.genero] : undefined;
  return [
    `Produto: ${input.nome}`,
    input.descricao ? `Descrição: ${input.descricao}` : '',
    genero ? `Gênero: ${genero}` : '',
    '',
    'Categorias candidatas:',
    lista,
    '',
    'Escolha a que melhor descreve o produto. Responda APENAS com o category_id exato da lista.',
    'Respeite o público (adulto/infantil/bebê/gestante) indicado no caminho das categorias e no gênero do produto.',
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
