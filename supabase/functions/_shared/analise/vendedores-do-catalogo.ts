// Ponte amostra do Sonar → vendedor pelo CATÁLOGO (ADR-0143 D-1).
//
// Medido em 2026-08-29 (spike 045): `/items?ids=` devolve 403 access_denied em 103 de 104 anúncios
// de terceiro, e `/items/{id}` idem. `/products/{catalog_product_id}/items` responde 200 em 26 de
// 26 e é a ÚNICA rota que entrega `seller_id` de terceiro. Não trocar por multiget.

import { mlGet } from '../ml/http.ts';
import { parseOfertasProduto } from '../pulse/parse.ts';
import { pool } from '../concorrencia/pool.ts';
import type { ItemVendas } from '../pulse/sonar-vendas.ts';

const API = 'https://api.mercadolibre.com';
// Mesmo teto das outras edges do Sonar; 4 a 9 catálogos por consulta, medido.
const CONCORRENCIA = 5;

export type VendedoresDoCatalogo = {
  /** Vendedores distintos que disputam os catálogos representados na amostra. */
  sellerIds: number[];
  /** item_id → seller_id, para os anúncios da amostra que aparecem nas fichas (7.4). */
  sellerPorItem: Map<string, number>;
  catalogos_consultados: number;
  catalogos_com_falha: number;
};

/** Catálogos distintos representados na amostra — a ponte só existe para quem tem catálogo. */
export function catalogosDaAmostra(itens: ItemVendas[]): string[] {
  const out = new Set<string>();
  for (const i of itens) {
    if (typeof i.catalog_product_id === 'string' && i.catalog_product_id) out.add(i.catalog_product_id);
  }
  return [...out];
}

/** Anúncios da amostra que têm catálogo — denominador honesto de 3.3 (ADR-0143 D-1). */
export function anunciosComCatalogo(itens: ItemVendas[]): number {
  return itens.filter((i) => typeof i.catalog_product_id === 'string' && i.catalog_product_id).length;
}

export async function resolverVendedoresDosCatalogos(
  catalogIds: string[],
  token: string,
): Promise<VendedoresDoCatalogo> {
  const sellerIds = new Set<number>();
  const sellerPorItem = new Map<string, number>();
  let falhas = 0;

  await pool(CONCORRENCIA, catalogIds, async (catalogId) => {
    // mlGet devolve null em falha (não lança). Ficha indisponível não invalida as outras:
    // conta como falha e a cobertura declara.
    const json = await mlGet(`${API}/products/${catalogId}/items`, token);
    if (json == null) {
      falhas++;
      return;
    }
    for (const oferta of parseOfertasProduto(json)) {
      sellerIds.add(oferta.seller_id);
      sellerPorItem.set(oferta.item_id, oferta.seller_id);
    }
  });

  return {
    sellerIds: [...sellerIds],
    sellerPorItem,
    catalogos_consultados: catalogIds.length,
    catalogos_com_falha: falhas,
  };
}
