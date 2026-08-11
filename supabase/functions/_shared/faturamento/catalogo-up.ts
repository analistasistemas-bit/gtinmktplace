// ADR-0088 §2 — funde os itens filhos User Products (anuncios_externos_itens, 1 por SKU/cor,
// cores 2..N) nos mapas do catálogo do vendedor (carregarCatalogo, io.ts). Sem isso, uma venda de
// cor 2..N não é reconhecida como PubliAI (is_publiai=false) e código/EAN ficam null — a mesma
// lacuna financeira corrigida em metricas-vendas/monitorar-moderados/status-publicados.
// Pura: sem rede/banco, muta os mapas recebidos (mesmo estilo de carregarCatalogo).
import { normGtin } from './venda.ts';

export interface CatalogoBase {
  idsPubliai: Set<string>;
  /** ml_item_id (ou item_externo_id do filho UP) → código do catálogo. */
  codPorItem: Map<string, string>;
  eanPorItem: Map<string, string>;
  infoPorGtin: Map<string, { codigo: string | null; ean: string | null }>;
}

export interface ItemUP {
  itemExternoId: string;
  /** = variacoes.codigo (mesma âncora estável do item filho, ADR-0088 "Ancoragem"). */
  sku: string;
  gtin: string | null;
}

/** Item plano UP nunca tem variation_id (cada item É a variação) — por isso os filhos entram só
 *  no mapa "por item" (fallback usado quando o resolver não acha por (item,variação)), nunca no
 *  mapa "por variação".
 *
 *  O filho SOBRESCREVE `codPorItem`/`eanPorItem`. Quando o `item_externo_id` do filho é também o
 *  `familias.ml_item_id` (a cor 1 da família migrada para UP), `carregarCatalogo` já semeou a
 *  chave — com a PRIMEIRA variação da família em ordem arbitrária (io.ts:96-98) ou com
 *  `familias.codigo_pai` (io.ts:103, que é o agrupador, não o produto vendido). Preservar esse
 *  valor gravava na venda o código/EAN de outra cor: em produção, 4 vendas com código errado e 6
 *  com EAN errado. O par `item_externo_id → sku` é 1:1 exato (ADR-0088 "Ancoragem") e vence
 *  qualquer valor derivado da família. Anúncio com variações reais não é afetado: a venda traz
 *  variation_id e o resolver acha por `codPorVar` antes de consultar o mapa por item. */
export function fundirItensUP(base: CatalogoBase, itensUP: ItemUP[]): void {
  for (const item of itensUP) {
    base.idsPubliai.add(item.itemExternoId);
    base.codPorItem.set(item.itemExternoId, item.sku);
    if (!item.gtin) continue;
    base.eanPorItem.set(item.itemExternoId, item.gtin);
    // infoPorGtin continua first-wins: a chave é o próprio GTIN, então uma entrada existente já é
    // deste mesmo produto — sobrescrever não corrigiria nada.
    const chave = normGtin(item.gtin);
    if (!base.infoPorGtin.has(chave)) base.infoPorGtin.set(chave, { codigo: item.sku, ean: item.gtin });
  }
}
