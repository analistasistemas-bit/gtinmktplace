// Ponte pagamento (Mercado Pago) → item do ML, para enriquecer o financeiro com o custo do
// produto. O pagamento do MP (/v1/payments/search) não carrega o ml_item_id; o pedido do ML
// (/orders/search) carrega tanto os ids dos pagamentos (`payments[].id` == id do pagamento no
// MP) quanto o item e a quantidade. Validado na conta real: o id do pagamento do pedido bate
// com o id do /payments do MP, e os pedidos de aviamento têm 1 item por pedido.

/** Recorte de um pedido do ML usado para mapear pagamento → item (demais campos ignorados). */
export interface PedidoComPagamentos {
  id: number | string;
  order_items?: Array<{
    item?: { id?: string | null; variation_id?: number | string | null } | null;
    quantity?: number | null;
  }> | null;
  payments?: Array<{ id?: number | string | null } | null> | null;
}

export interface ItemDoPagamento {
  mlItemId: string;
  /** ml_variation_id do item vendido (cor), quando o anúncio tem variações. null = sem variação. */
  mlVariationId: string | null;
  quantidade: number;
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
    for (const oi of itens) {
      const id = oi?.item?.id;
      if (id) ids.add(id);
      const varId = oi?.item?.variation_id;
      if (varId != null) variacoes.add(String(varId));
      quantidade += Number(oi?.quantity ?? 0);
    }
    // Só pedidos com exatamente um item distinto (custo inequívoco).
    if (ids.size !== 1) continue;
    const mlItemId = [...ids][0];
    // Variação só quando há exatamente uma (senão custo ambíguo → fallback por item).
    const mlVariationId = variacoes.size === 1 ? [...variacoes][0] : null;

    for (const pg of pedido.payments ?? []) {
      const pid = pg?.id;
      if (pid == null) continue;
      out[String(pid)] = { mlItemId, mlVariationId, quantidade };
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
