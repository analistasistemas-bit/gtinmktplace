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
 *  mapa "por variação". Não sobrescreve uma entrada já existente (ex.: cor 1, resolvida antes pela
 *  família legada). */
export function fundirItensUP(base: CatalogoBase, itensUP: ItemUP[]): void {
  for (const item of itensUP) {
    base.idsPubliai.add(item.itemExternoId);
    if (!base.codPorItem.has(item.itemExternoId)) base.codPorItem.set(item.itemExternoId, item.sku);
    if (!item.gtin) continue;
    if (!base.eanPorItem.has(item.itemExternoId)) base.eanPorItem.set(item.itemExternoId, item.gtin);
    const chave = normGtin(item.gtin);
    if (!base.infoPorGtin.has(chave)) base.infoPorGtin.set(chave, { codigo: item.sku, ean: item.gtin });
  }
}
