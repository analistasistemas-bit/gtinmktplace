import { escolherEntreCandidatos, type DepsResolver, type InputCategoria, type ResultadoCategoria } from '../_shared/categoria/resolver.ts';
import type { FichaBusca } from '../_shared/ml/catalogo.ts';
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

const MIN_PALAVRAS_EM_COMUM = 2;
const MAX_FICHAS = 5;

function palavrasDoNome(texto: string): Set<string> {
  const limpo = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return new Set((limpo.match(/[a-z]{4,}/g) ?? []));
}

/**
 * Resgate quando o nome não basta e o GTIN não casou no catálogo (ADR-0026 emenda 2026-11-07).
 * Só usa ficha que compartilha 2+ palavras reais com o nome, e só candidato do domínio dessas
 * fichas. Exige escolha confirmada pela IA: abstenção ou falha técnica → null (segue manual).
 */
export async function categoriaPorBuscaCatalogo(
  input: InputCategoria,
  deps: DepsResolver,
  buscarFichas: (nome: string) => Promise<FichaBusca[]>,
): Promise<ResultadoCategoria | null> {
  try {
    const doNome = palavrasDoNome(input.nome);
    const fichas = (await buscarFichas(input.nome))
      .filter((f) => [...palavrasDoNome(f.nome)].filter((p) => doNome.has(p)).length >= MIN_PALAVRAS_EM_COMUM)
      .slice(0, MAX_FICHAS);
    const dominios = new Set(fichas.map((f) => f.domainId));
    const porFicha = await Promise.all(fichas.map((f) => deps.preditor(f.nome)));
    const candidatos = [...new Map(
      porFicha.flat().filter((c) => dominios.has(c.domainId)).map((c) => [c.categoriaId, c]),
    ).values()];
    let confirmada = false;
    const r = await escolherEntreCandidatos(input, candidatos, async (i, cands) => {
      const id = await deps.llm?.(i, cands);
      confirmada = cands.some((c) => c.categoriaId === id);
      return id;
    });
    return confirmada && r.categoriaId && r.origem !== 'generico' ? r : null;
  } catch (e) {
    console.warn('categoria por busca no catálogo falhou:', e);
    return null;
  }
}
