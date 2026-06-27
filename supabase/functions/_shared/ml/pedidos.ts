// Ponte pagamento (Mercado Pago) → item do ML, para enriquecer o financeiro com o custo do
// produto. O pagamento do MP (/v1/payments/search) não carrega o ml_item_id; o pedido do ML
// (/orders/search) carrega tanto os ids dos pagamentos (`payments[].id` == id do pagamento no
// MP) quanto o item e a quantidade. Validado na conta real: o id do pagamento do pedido bate
// com o id do /payments do MP, e os pedidos de aviamento têm 1 item por pedido.

import { round2 } from '../dinheiro.ts';

/** Recorte de um pedido do ML usado para mapear pagamento → item (demais campos ignorados). */
export interface PedidoComPagamentos {
  id: number | string;
  order_items?: Array<{
    item?: { id?: string | null; variation_id?: number | string | null } | null;
    quantity?: number | null;
    /** Tarifa de venda do ML do item (comissão + cobrança + parcelamento). */
    sale_fee?: number | null;
  }> | null;
  payments?: Array<{ id?: number | string | null } | null> | null;
  /** Envio do pedido — pedidos de um mesmo pack compartilham o id (e o frete). */
  shipping?: { id?: number | string | null } | null;
}

export interface ItemDoPagamento {
  mlItemId: string;
  /** ml_variation_id do item vendido (cor), quando o anúncio tem variações. null = sem variação. */
  mlVariationId: string | null;
  quantidade: number;
  /** Soma das tarifas de venda do ML do pedido (sale_fee). Base p/ separar frete do retido. */
  tarifaItem: number;
  /** Id do envio do pedido — linhas com o mesmo id compartilham um frete (rateio). */
  shippingId: string | null;
}

/**
 * Mapa payment_id (string) → { item, variação, quantidade } a partir dos pedidos. Só mapeia
 * pedidos com UM item distinto (markup por linha exige custo de um único produto); pedidos
 * multi-item ficam de fora (a linha mostra "—"). A variação só é fixada quando o pedido tem uma
 * única variação distinta (senão null → cai no custo por item). A quantidade é a soma das
 * quantidades do item no pedido. Pura.
 */
export function mapearPagamentoParaItem(
  pedidos: PedidoComPagamentos[],
): Record<string, ItemDoPagamento> {
  const out: Record<string, ItemDoPagamento> = {};

  for (const pedido of pedidos) {
    const itens = pedido.order_items ?? [];
    const ids = new Set<string>();
    const variacoes = new Set<string>();
    let quantidade = 0;
    let tarifa = 0;
    for (const oi of itens) {
      const id = oi?.item?.id;
      if (id) ids.add(id);
      const varId = oi?.item?.variation_id;
      if (varId != null) variacoes.add(String(varId));
      quantidade += Number(oi?.quantity ?? 0);
      tarifa += Number(oi?.sale_fee ?? 0);
    }
    // Só pedidos com exatamente um item distinto (custo inequívoco).
    if (ids.size !== 1) continue;
    const mlItemId = [...ids][0];
    // Variação só quando há exatamente uma (senão custo ambíguo → fallback por item).
    const mlVariationId = variacoes.size === 1 ? [...variacoes][0] : null;
    const shippingId = pedido.shipping?.id != null ? String(pedido.shipping.id) : null;

    for (const pg of pedido.payments ?? []) {
      const pid = pg?.id;
      if (pid == null) continue;
      out[String(pid)] = { mlItemId, mlVariationId, quantidade, tarifaItem: round2(tarifa), shippingId };
    }
  }

  return out;
}

const API = 'https://api.mercadolibre.com';

/**
 * Varre /orders/search do vendedor no período (pedidos pagos) e devolve o recorte com pagamentos
 * e itens. Espelha lerVendasML (mesmo seller/paginação/resiliência): erro na 1ª página propaga;
 * nas seguintes devolve o parcial. O chamador deve tratar exceção (markup é opcional).
 */
export async function buscarPedidosML(
  token: string,
  intervalo: { desde: string; ate: string },
): Promise<PedidoComPagamentos[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const signal = AbortSignal.timeout(25_000);

  const meResp = await fetch(`${API}/users/me`, { headers, signal });
  if (!meResp.ok) throw new Error(`ML /users/me ${meResp.status}`);
  const me = await meResp.json();
  const seller = me?.id;
  if (!seller) throw new Error('ML: seller id ausente');

  const pedidos: PedidoComPagamentos[] = [];
  const limit = 50;
  let offset = 0;
  while (offset < 2000) {
    const params = new URLSearchParams({
      seller: String(seller),
      'order.status': 'paid',
      'order.date_created.from': intervalo.desde,
      'order.date_created.to': intervalo.ate,
      sort: 'date_desc',
      offset: String(offset),
      limit: String(limit),
    });
    let resp: Response;
    try {
      resp = await fetch(`${API}/orders/search?${params}`, { headers, signal });
    } catch (e) {
      if (offset === 0) throw new Error(`ML /orders indisponível: ${(e as Error).message}`);
      break;
    }
    if (!resp.ok) {
      if (offset === 0) {
        const corpo = await resp.text().catch(() => '');
        throw new Error(`ML /orders ${resp.status}: ${corpo.slice(0, 200)}`);
      }
      break;
    }
    const data = await resp.json();
    const results: PedidoComPagamentos[] = Array.isArray(data?.results) ? data.results : [];
    pedidos.push(...results);
    const total = Number(data?.paging?.total ?? pedidos.length);
    offset += limit;
    if (results.length === 0 || offset >= total) break;
  }

  return pedidos;
}

interface ItemComAtributos {
  id?: string | null;
  attributes?: Array<{ id?: string | null; value_name?: string | null }> | null;
}

/** Extrai o GTIN do item do ML a partir do array de attributes. null se ausente. Pura. */
export function extrairGtin(item: ItemComAtributos | null | undefined): string | null {
  const attr = (item?.attributes ?? []).find((a) => a?.id === 'GTIN');
  const v = attr?.value_name;
  return v ? String(v).trim() : null;
}

/**
 * GTIN de cada anúncio (ml_item_id → gtin) via /items multiget em lote (20 por chamada). Usado
 * só para os anúncios que não casaram custo por variação/item (fallback). Resiliente: bloco que
 * falha é ignorado (aqueles anúncios ficam sem markup). Devolve só os que têm GTIN.
 */
export async function buscarGtinsDosItens(
  token: string,
  itemIds: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (itemIds.length === 0) return out;
  const headers = { Authorization: `Bearer ${token}` };
  const signal = AbortSignal.timeout(25_000);

  for (let i = 0; i < itemIds.length; i += 20) {
    const bloco = itemIds.slice(i, i + 20);
    try {
      const url = `${API}/items?ids=${bloco.join(',')}&attributes=id,attributes`;
      const resp = await fetch(url, { headers, signal });
      if (!resp.ok) continue;
      const arr = await resp.json(); // [{ code, body: { id, attributes } }]
      if (!Array.isArray(arr)) continue;
      for (const e of arr) {
        if (e?.code !== 200) continue;
        const id = e?.body?.id;
        const gtin = extrairGtin(e?.body);
        if (id && gtin) out[id] = gtin;
      }
    } catch {
      // Bloco indisponível: aqueles anúncios ficam sem GTIN → sem markup. Não derruba os demais.
      continue;
    }
  }
  return out;
}
