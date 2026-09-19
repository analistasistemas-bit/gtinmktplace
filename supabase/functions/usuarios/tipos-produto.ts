// ADR-0166: saneamento do payload de `set_tipos_produto_org`. Extraido do handler porque o
// handler inteiro nao e testavel (mesma limitacao ja documentada em cadastrar-produto/processar.ts).
//
// R7 da revisao do Fable: a whitelist NAO e redigitada aqui — vem da fonte unica. Uma lista
// copiada em tres arquivos e uma lista que diverge no primeiro valor novo.
import { TIPOS_PRODUTO_VALIDOS } from '../_shared/produto/tipos-produto-valores.ts';

/** Saida SEMPRE na ordem canonica de TIPOS_PRODUTO_VALIDOS, nao na ordem do payload: assim duas
 *  gravacoes equivalentes produzem o mesmo array e um diff de auditoria nao acusa mudanca falsa.
 *  Diferente de set_canais_org, NAO ha valor obrigatorio: lista vazia e o default de toda org. */
export function sanearTiposProduto(bruto: unknown): string[] {
  if (!Array.isArray(bruto)) return [];
  const pedidos = new Set(bruto.filter((t): t is string => typeof t === 'string'));
  return TIPOS_PRODUTO_VALIDOS.filter((t) => pedidos.has(t));
}
