// Transformações puras do módulo Faturamento (ADR-0037). Sem Deno/npm — testável no vitest.
// Converte o payload de /orders/{id} do ML em linhas de `ml_vendas` + `ml_vendas_itens`, e
// faz o parse da notificação de webhook do ML.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Notificação de webhook do ML, já normalizada. */
export interface WebhookEvento {
  topic: string;
  resource: string;
  resourceId: string;
  /** id do vendedor no ML (numérico). Usado para resolver o user_id local. */
  mlUserId: number;
}

/** Extrai o último segmento numérico de um resource (`/orders/123` → `123`). null se ausente. */
export function extrairIdDoResource(resource: string | null | undefined): string | null {
  if (!resource) return null;
  const partes = resource.split('/').filter(Boolean);
  const ultimo = partes[partes.length - 1];
  return ultimo && /^\d+$/.test(ultimo) ? ultimo : null;
}

/** Normaliza a notificação do ML. null quando faltam campos obrigatórios. */
export function parseWebhookNotification(raw: unknown): WebhookEvento | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const topic = typeof p.topic === 'string' ? p.topic : null;
  const resource = typeof p.resource === 'string' ? p.resource : null;
  const mlUserId = typeof p.user_id === 'number' ? p.user_id : Number(p.user_id);
  if (!topic || !resource || !Number.isFinite(mlUserId)) return null;
  const resourceId = extrairIdDoResource(resource);
  if (!resourceId) return null;
  return { topic, resource, resourceId, mlUserId };
}

/** Líquido estimado: total − comissão ML − frete do vendedor (frete null = 0). 2 casas. */
export function calcularLiquido(total: number, saleFee: number, frete: number | null): number {
  return round2(total - saleFee - (frete ?? 0));
}

export interface VendaRow {
  order_id: number;
  pack_id: number | null;
  status: string;
  status_detail: string | null;
  date_created: string | null;
  date_closed: string | null;
  comprador_id: number | null;
  comprador_nick: string | null;
  total_amount: number;
  paid_amount: number | null;
  sale_fee_total: number;
  frete_vendedor: number | null;
  liquido: number | null;
  currency: string;
  shipping_id: number | null;
  is_publiai: boolean;
}

export interface VendaItemRow {
  ml_item_id: string | null;
  variation_id: number | null;
  titulo: string | null;
  codigo: string | null;
  quantity: number;
  unit_price: number;
  sale_fee: number;
  is_publiai: boolean;
}

/** Recorte do pedido do ML (/orders/{id}) usado no mapeamento. */
export interface PedidoML {
  id: number | string;
  status?: string | null;
  status_detail?: string | null;
  pack_id?: number | string | null;
  date_created?: string | null;
  date_closed?: string | null;
  currency_id?: string | null;
  total_amount?: number | null;
  paid_amount?: number | null;
  buyer?: { id?: number | string | null; nickname?: string | null } | null;
  shipping?: { id?: number | string | null } | null;
  order_items?: Array<{
    item?: { id?: string | null; title?: string | null; variation_id?: number | string | null } | null;
    quantity?: number | null;
    unit_price?: number | null;
    sale_fee?: number | null;
  }> | null;
}

export interface MapearOpts {
  /** ml_item_id dos anúncios gerenciados pelo PubliAI (define is_publiai). */
  idsPubliai: Set<string>;
  /** Resolve o código do catálogo a partir do (ml_item_id, variation_id). null = não mapeado. */
  codigoResolver: (mlItemId: string | null, variationId: number | null) => string | null;
  /** Custo de envio pago pelo vendedor (vem do shipment, opcional). */
  freteVendedor?: number | null;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Converte um pedido do ML em uma linha de venda + suas linhas de item. Pura. */
export function mapearPedidoParaVenda(
  pedido: PedidoML,
  opts: MapearOpts,
): { venda: VendaRow; itens: VendaItemRow[] } {
  const itensRaw = pedido.order_items ?? [];
  let saleFeeTotal = 0;
  let isPubliai = false;

  const itens: VendaItemRow[] = itensRaw.map((oi) => {
    const mlItemId = oi?.item?.id ?? null;
    const variationId = num(oi?.item?.variation_id ?? null);
    const saleFee = round2(Number(oi?.sale_fee ?? 0));
    saleFeeTotal += saleFee;
    const itemPubliai = mlItemId != null && opts.idsPubliai.has(mlItemId);
    if (itemPubliai) isPubliai = true;
    return {
      ml_item_id: mlItemId,
      variation_id: variationId,
      titulo: oi?.item?.title ?? null,
      codigo: itemPubliai ? opts.codigoResolver(mlItemId, variationId) : null,
      quantity: Number(oi?.quantity ?? 0),
      unit_price: Number(oi?.unit_price ?? 0),
      sale_fee: saleFee,
      is_publiai: itemPubliai,
    };
  });

  saleFeeTotal = round2(saleFeeTotal);
  const total = Number(pedido.total_amount ?? 0);
  const frete = opts.freteVendedor ?? null;

  const venda: VendaRow = {
    order_id: Number(pedido.id),
    pack_id: num(pedido.pack_id ?? null),
    status: pedido.status ?? 'unknown',
    status_detail: pedido.status_detail ?? null,
    date_created: pedido.date_created ?? null,
    date_closed: pedido.date_closed ?? null,
    comprador_id: num(pedido.buyer?.id ?? null),
    comprador_nick: pedido.buyer?.nickname ?? null,
    total_amount: round2(total),
    paid_amount: num(pedido.paid_amount ?? null),
    sale_fee_total: saleFeeTotal,
    frete_vendedor: frete,
    liquido: calcularLiquido(total, saleFeeTotal, frete),
    currency: pedido.currency_id ?? 'BRL',
    shipping_id: num(pedido.shipping?.id ?? null),
    is_publiai: isPubliai,
  };

  return { venda, itens };
}
