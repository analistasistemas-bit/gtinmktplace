import type { Herdado } from '../_shared/update/casar.ts';

/**
 * Preço de publicação de uma variação no UPDATE (ADR-0016) + a marca de preço fixado (D15 do
 * reajuste). Cor casada herda preço E marca da variação anterior. No UPDATE o process-familia
 * encerra cedo (não recalcula preço), então o preço da cor casada sobrevive porque o ingest copia
 * `preco_publicacao`; a marca herdada preserva o estado "fixado pelo operador" para o selo da
 * Revisão e para os fluxos que recalculam. Cor nova herda o preço de venda da família (ou a
 * planilha) e nasce sem marca.
 */
export function precoHerdadoUpdate(
  h: Herdado | undefined, precoPubFamilia: number | null, precoPlanilha: number,
): { preco_publicacao: number | string; preco_editado_pelo_operador: boolean } {
  return {
    preco_publicacao: h?.preco_publicacao ?? precoPubFamilia ?? precoPlanilha,
    // Marca só acompanha um preço herdado de fato: sem preço anterior, não há o que preservar.
    preco_editado_pelo_operador: h?.preco_publicacao != null && h.preco_editado_pelo_operador === true,
  };
}
