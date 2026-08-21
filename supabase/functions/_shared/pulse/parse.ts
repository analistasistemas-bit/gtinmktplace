import type { OfertaColetada, PriceToWin } from './tipos.ts';

// /products/{id}/items → results[]: item_id, price, seller_id, listing_type_id,
// shipping.free_shipping, shipping.logistic_type, official_store_id. sold/available vêm null —
// não parsear.
// `permalink` é lido de forma oportunista: se a ficha não o expuser, o enriquecimento posterior
// deriva o link público a partir do item_id.
// `excluirSellerId` = nossa própria conta no ML: a lista do catálogo inclui a NOSSA oferta, e
// sem excluí-la o radar trataria o próprio anúncio como concorrente (alerta "preço caiu" quando
// nós mesmos baixamos, "novo concorrente" quando nós publicamos).
export function parseOfertasProduto(json: unknown, excluirSellerId?: number | null): OfertaColetada[] {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: OfertaColetada[] = [];
  for (const r of results) {
    const o = r as Record<string, unknown>;
    const itemId = typeof o.item_id === 'string' ? o.item_id : null;
    const preco = typeof o.price === 'number' ? o.price : null;
    const sellerId = typeof o.seller_id === 'number' ? o.seller_id : null;
    if (!itemId || preco == null || sellerId == null) continue;
    if (excluirSellerId != null && sellerId === excluirSellerId) continue;
    out.push({
      item_id: itemId,
      seller_id: sellerId,
      preco,
      tier: typeof o.listing_type_id === 'string' ? o.listing_type_id : null,
      frete_gratis: Boolean((o.shipping as { free_shipping?: unknown } | null)?.free_shipping),
      full_ml: (o.shipping as { logistic_type?: unknown } | null)?.logistic_type === 'fulfillment',
      loja_oficial: o.official_store_id != null,
      // Só aceita URL http(s) de verdade: string vazia ou caminho relativo viraria um link quebrado
      // na tela, e link quebrado é pior do que ausência de link.
      permalink: typeof o.permalink === 'string' && /^https?:\/\//.test(o.permalink) ? o.permalink : null,
    });
  }
  return out;
}

/**
 * Nossa própria oferta na ficha, da MESMA resposta de `/products/{id}/items` — é o preço que o
 * comprador vê, na mesma base dos concorrentes. `/items/{id}` não serve: devolve o preço base,
 * sem a promoção ativa (ADR-0119, Errata 4).
 *
 * Com anúncio publicado por faixa (split) temos mais de uma oferta na ficha; vence a de MENOR
 * preço, que é a comparável com o menor concorrente.
 */
export function extrairNossaOferta(
  json: unknown,
  sellerId: number | null | undefined,
): { item_id: string; preco: number } | null {
  const results = (json as { results?: unknown[] } | null)?.results;
  if (!Array.isArray(results) || sellerId == null) return null;
  let melhor: { item_id: string; preco: number } | null = null;
  for (const r of results) {
    const o = r as Record<string, unknown>;
    if (o.seller_id !== sellerId) continue;
    const itemId = typeof o.item_id === 'string' ? o.item_id : null;
    const preco = typeof o.price === 'number' ? o.price : null;
    if (!itemId || preco == null) continue;
    if (!melhor || preco < melhor.preco) melhor = { item_id: itemId, preco };
  }
  return melhor;
}

/**
 * A ficha pode ter mais ofertas do que o ML devolve numa página (teto de 100). Quando isso
 * acontece o radar está vendo um subconjunto — e a nossa oferta pode ficar de fora, zerando a
 * coluna "Seu preço" sem motivo aparente. Devolve o excedente para o chamador registrar.
 */
export function ofertasNaoLidas(json: unknown): number {
  const p = (json as { paging?: { total?: unknown } } | null)?.paging;
  const results = (json as { results?: unknown[] } | null)?.results;
  if (typeof p?.total !== 'number' || !Array.isArray(results)) return 0;
  return Math.max(0, p.total - results.length);
}

/**
 * Multiget `/items?ids=...` — situação dos NOSSOS anúncios. A resposta é uma lista de envelopes
 * `{ code, body }`: um id inválido volta com `code` de erro no meio dos que deram certo, e tratar
 * o lote inteiro como perdido apagaria a situação de todos os outros.
 */
export interface AnuncioMultiget {
  item_id: string;
  status: string | null;
  sub_status: string[] | null;
  /** Necessários para consultar a comissão do ML no preço praticado (Errata 6). */
  category_id: string | null;
  listing_type_id: string | null;
  price: number | null;
}

export function parseStatusAnuncios(json: unknown): AnuncioMultiget[] {
  if (!Array.isArray(json)) return [];
  const out: AnuncioMultiget[] = [];
  for (const r of json) {
    const env = r as { code?: unknown; body?: unknown };
    if (env?.code !== 200) continue;
    const b = env.body as Record<string, unknown> | null;
    const id = typeof b?.id === 'string' ? b.id : null;
    if (!id) continue;
    out.push({
      item_id: id,
      status: typeof b?.status === 'string' ? b.status : null,
      sub_status: Array.isArray(b?.sub_status) ? (b.sub_status as unknown[]).filter((s): s is string => typeof s === 'string') : null,
      category_id: typeof b?.category_id === 'string' ? b.category_id : null,
      listing_type_id: typeof b?.listing_type_id === 'string' ? b.listing_type_id : null,
      price: typeof b?.price === 'number' ? b.price : null,
    });
  }
  return out;
}

/**
 * `/sites/MLB/listing_prices` — estrutura da comissão para um preço. Guardamos percentual e
 * parcela fixa, não o valor pronto: `sale_fee_amount` só vale para o preço consultado, e o
 * simulador precisa recalcular. Verificado que `pct * preço + fixo` reproduz `sale_fee_amount`
 * em todas as faixas testadas (ADR-0119, Errata 6).
 */
export function parseComissao(json: unknown): { pct: number; fixa: number } | null {
  const d = (json as { sale_fee_details?: Record<string, unknown> } | null)?.sale_fee_details;
  if (!d) return null;
  const pct = typeof d.percentage_fee === 'number' ? d.percentage_fee : null;
  if (pct == null) return null;
  return { pct, fixa: typeof d.fixed_fee === 'number' ? d.fixed_fee : 0 };
}

// /suggestions/items/{id}/details
export function parsePriceToWin(json: unknown): PriceToWin | null {
  const d = json as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || d.status == null) return null;
  const sug = (d.suggested_price as { amount?: unknown } | null)?.amount;
  const costs = d.costs as { selling_fees?: unknown; shipping_fees?: unknown } | null;
  return {
    status: typeof d.status === 'string' ? d.status : null,
    preco_sugerido: typeof sug === 'number' ? sug : null,
    // Só `true`/`false` viram valor; qualquer outra coisa fica null e a tela trata como
    // "não sabemos", que é diferente de "não se aplica".
    aplicavel: typeof d.applicable_suggestion === 'boolean' ? d.applicable_suggestion : null,
    custos: costs
      ? {
          comissao: typeof costs.selling_fees === 'number' ? costs.selling_fees : null,
          frete: typeof costs.shipping_fees === 'number' ? costs.shipping_fees : null,
        }
      : null,
  };
}
