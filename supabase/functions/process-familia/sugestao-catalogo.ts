import {
  deveSugerirCategoriaPorFicha,
  montarEsperadoPrePublicacao,
  type AtributosFicha,
  type CategoriaFicha,
} from '../_shared/ml/catalogo.ts';

/** O que o process-familia persiste em familias.catalogo_categoria_sugerida_*. */
export interface SugestaoCatalogoPersistir {
  id: string;
  nome: string | null;
  vendedores: number | null;
}

/** Deps injetadas (mesmo padrão de resolver.ts): testável sem rede. */
export interface DepsSugestaoCatalogo {
  buscarFicha(gtin: string | null): Promise<AtributosFicha | null>;
  buscarDominio(categoriaId: string): Promise<string | null>;
  buscarItensFicha(fichaId: string): Promise<CategoriaFicha | null>;
  buscarNome(categoriaId: string): Promise<string | null>;
}

/**
 * Sugestão de categoria pela ficha de catálogo (spec 2026-08-22, estende ADR-0057).
 * Best-effort: qualquer falha → null (sem sugestão), NUNCA lança — roda dentro do
 * processamento da família e não pode derrubá-lo. Nunca aplicada sozinha (ADR-0054 Fase 2).
 */
export async function calcularSugestaoCatalogo(
  deps: DepsSugestaoCatalogo,
  args: { gtin: string | null; categoriaMlId: string; atributosMl: Array<{ id: string; value_name?: string }> },
): Promise<SugestaoCatalogoPersistir | null> {
  try {
    const ficha = await deps.buscarFicha(args.gtin);
    if (!ficha) return null;
    const dominioEscolhido = await deps.buscarDominio(args.categoriaMlId);
    if (!deveSugerirCategoriaPorFicha(ficha, montarEsperadoPrePublicacao(args.atributosMl), dominioEscolhido)) {
      return null;
    }
    const itens = await deps.buscarItensFicha(ficha.id);
    if (!itens?.categoriaId || itens.categoriaId === args.categoriaMlId) return null;
    return {
      id: itens.categoriaId,
      nome: await deps.buscarNome(itens.categoriaId).catch(() => null),
      vendedores: itens.vendedores,
    };
  } catch (e) {
    console.warn(`sugestão de categoria por ficha falhou (segue sem): ${(e as Error).message}`);
    return null;
  }
}
