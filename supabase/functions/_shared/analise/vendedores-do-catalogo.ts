// Ponte amostra do Sonar → vendedor pelo CATÁLOGO (ADR-0143 D-1).
//
// Medido em 2026-08-29 (spike 045): `/items?ids=` devolve 403 access_denied em 103 de 104 anúncios
// de terceiro, e `/items/{id}` idem. `/products/{catalog_product_id}/items` responde 200 em 26 de
// 26 e é a ÚNICA rota que entrega `seller_id` de terceiro. Não trocar por multiget.

import { mlGet } from '../ml/http.ts';
import { parseOfertasProduto } from '../pulse/parse.ts';
import { pool } from '../concorrencia/pool.ts';
import { redisGet, redisSet } from '../redis/client.ts';
import type { ItemVendas } from '../pulse/sonar-vendas.ts';

const API = 'https://api.mercadolibre.com';
// Mesmo teto das outras edges do Sonar; 4 a 9 catálogos por consulta, medido.
const CONCORRENCIA = 5;
// Dado público (ADR-0120 §3), cache global por catálogo. 24h como a pulse-sonar-visitas: a lista
// de quem disputa uma ficha muda em dias, e sem cache todo "atualizar" refaz 4 a 9 chamadas.
const CACHE_TTL_S = 24 * 60 * 60;

type OfertaDoCatalogo = { item_id: string; seller_id: number };

export type VendedoresDoCatalogo = {
  /** Vendedores distintos que disputam os catálogos resolvidos com sucesso. */
  sellerIds: number[];
  /** item_id → seller_id, para os anúncios da amostra que aparecem nas fichas (7.4). */
  sellerPorItem: Map<string, number>;
  /** Catálogos cuja ficha respondeu — só estes contam como ponte na cobertura (3.3). */
  catalogosOk: Set<string>;
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

/**
 * Anúncios da amostra com ponte REAL para o vendedor — numerador honesto de 3.3.
 * Conta só os cujo catálogo respondeu: ficha que falhou some do conjunto de vendedores por trás
 * de 3.2, então não pode continuar contando como coberta.
 */
export function anunciosComCatalogo(itens: ItemVendas[], catalogosOk: Set<string>): number {
  return itens.filter((i) =>
    typeof i.catalog_product_id === 'string' && catalogosOk.has(i.catalog_product_id)).length;
}

async function ofertasDoCatalogo(
  catalogId: string,
  token: string,
): Promise<OfertaDoCatalogo[] | null> {
  const chave = `sonar:cat-vendedores:v1:${catalogId}`;
  const cacheado = await redisGet(chave).catch(() => null);
  if (cacheado) return JSON.parse(cacheado) as OfertaDoCatalogo[];

  // mlGet devolve null em falha (não lança). Falha NÃO cacheia: erro transitório não pode
  // esconder um catálogo por 24h.
  const json = await mlGet(`${API}/products/${catalogId}/items`, token);
  if (json == null) return null;

  const ofertas = parseOfertasProduto(json)
    .map(({ item_id, seller_id }) => ({ item_id, seller_id }));
  await redisSet(chave, JSON.stringify(ofertas), CACHE_TTL_S).catch(() => {});
  return ofertas;
}

export async function resolverVendedoresDosCatalogos(
  catalogIds: string[],
  token: string,
  /**
   * Conta da própria organização no ML. A ficha do catálogo inclui a NOSSA oferta, e contá-la
   * inflaria o nicho com um "concorrente" que somos nós — mesmo motivo do `excluirSellerId` do
   * Radar (`parse.ts`). O Sonar roda antes de cadastrar, então em geral não aparece; "em geral"
   * não é garantia.
   */
  excluirSellerId?: number | null,
): Promise<VendedoresDoCatalogo> {
  const sellerIds = new Set<number>();
  const sellerPorItem = new Map<string, number>();
  const catalogosOk = new Set<string>();
  let falhas = 0;

  await pool(CONCORRENCIA, catalogIds, async (catalogId) => {
    const ofertas = await ofertasDoCatalogo(catalogId, token);
    if (ofertas == null) {
      falhas++;
      return;
    }
    catalogosOk.add(catalogId);
    for (const oferta of ofertas) {
      if (excluirSellerId != null && oferta.seller_id === excluirSellerId) continue;
      sellerIds.add(oferta.seller_id);
      sellerPorItem.set(oferta.item_id, oferta.seller_id);
    }
  });

  return {
    sellerIds: [...sellerIds],
    sellerPorItem,
    catalogosOk,
    catalogos_consultados: catalogIds.length,
    catalogos_com_falha: falhas,
  };
}
