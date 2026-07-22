// ADR-0088 §2 — correção financeira PRÉ-REQUISITO de go-live. No modelo User Products, cada cor
// 2..N de uma família multi-cor é um item ML SEPARADO (anuncios_externos_itens, 1 por SKU), fora
// do `familias.ml_item_id` (que cobre só a 1ª cor/partição 0, ADR §5). Sem unir esses itens filhos
// ao escopo por org, `metricas-vendas`/`monitorar-moderados`/`status-publicados` só enxergam a 1ª
// cor: vendas das demais viram "externas", moderação fica invisível, status mostra só uma cor.
// Puras: sem rede/banco, operam sobre linhas já lidas do banco pelos index.ts.

/** metricas-vendas / status-publicados: união simples de ids (dedup, filtra null/undefined). */
export function unirIdsUP(...listas: Array<Array<string | null | undefined>>): string[] {
  return [...new Set(listas.flat().filter((id): id is string => !!id))];
}

export interface ItemModeracao { nome: string | null; permalink: string | null }

/** monitorar-moderados: estende o mapa ml_item_id→{nome,permalink} com os filhos UP da org. Não
 *  clobber um id já presente (a 1ª cor já está no mapa via familias, com nome real da família) —
 *  os filhos 2..N entram sem nome próprio (o alerta cai no fallback ml_item_id, ver telegram.ts).
 *  Pura: devolve um Map novo, não muta o `base` recebido. */
export function estenderEscopoModeracao(
  base: Map<string, ItemModeracao>,
  itensUP: Array<{ item_externo_id: string | null; permalink: string | null }>,
): Map<string, ItemModeracao> {
  const estendido = new Map(base);
  for (const i of itensUP) {
    if (i.item_externo_id && !estendido.has(i.item_externo_id)) {
      estendido.set(i.item_externo_id, { nome: null, permalink: i.permalink });
    }
  }
  return estendido;
}
