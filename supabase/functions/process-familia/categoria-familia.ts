import { escolherEntreCandidatos, type DepsResolver, type InputCategoria, type ResultadoCategoria } from '../_shared/categoria/resolver.ts';
import { GRADES_VALIDAS, type GradeTamanho } from '../_shared/produto/tipos-produto-valores.ts';

/** Claim da família → entrada do resolver de categoria. `genero` (familias.genero) só informa o
 *  público ao desempate por IA (ADR-0026 emenda 2026-10-17); `grade_tamanho` restringe os
 *  candidatos aos domínios que a publicação da grade aceita (ADR-0182, emenda 2026-10-18). */
export function inputCategoriaDaFamilia(
  f: { nome_pai: string; descricao_pai: string | null; genero: string | null; grade_tamanho?: string | null },
  tipoProdutoBusca?: string,
): InputCategoria {
  const grade = GRADES_VALIDAS.includes(f.grade_tamanho as GradeTamanho) ? (f.grade_tamanho as GradeTamanho) : undefined;
  return { nome: f.nome_pai, descricao: f.descricao_pai ?? undefined, genero: f.genero, tipoProdutoBusca, grade };
}

/**
 * Categoria via NOME de catálogo do concorrente (lote #27): re-roda o preditor com o nome canônico
 * e submete os candidatos ao MESMO desempate do resolver (antes aplicava o 1º específico às cegas —
 * o mesmo erro bebê × adulto do caso MLB188064 → MLB278065). Devolve só resultado ESPECÍFICO; null
 * (abstenção, só genérico, nada encontrado, falha) → o chamador mantém o resultado textual.
 */
export async function categoriaPorCatalogo(
  input: InputCategoria,
  nomeCatalogo: string,
  deps: DepsResolver,
): Promise<ResultadoCategoria | null> {
  const candidatos = await deps.preditor(nomeCatalogo).catch(() => []);
  const r = await escolherEntreCandidatos(input, candidatos, deps.llm);
  if (!r.categoriaId || r.origem === 'generico') return null;
  return r;
}
