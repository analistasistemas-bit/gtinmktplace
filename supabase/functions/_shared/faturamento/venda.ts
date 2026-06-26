// Transformações puras do módulo Faturamento (ADR-0037). Sem Deno/npm — testável no vitest.
// Converte o payload de /orders/{id} do ML em linhas de `ml_vendas` + `ml_vendas_itens`, e
// faz o parse da notificação de webhook do ML.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** GTIN normalizado (sem zeros à esquerda) para casar entre ML e planilha. */
export const normGtin = (g: string) => g.replace(/^0+/, '');

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
  comprador_nome: string | null;
  total_amount: number;
  paid_amount: number | null;
  sale_fee_total: number;
  frete_vendedor: number | null;
  liquido: number | null;
  /** Total estornado na venda (MP). null = sem dado do MP. */
  estorno: number | null;
  /** Data de liberação do recebimento (MP money_release_date). null = sem dado. */
  money_release_date: string | null;
  currency: string;
  shipping_id: number | null;
  is_publiai: boolean;
}

/** Dados do pagamento vindos do Mercado Pago (ADR-0038), por payment id. */
export interface DadosPagamentoMP {
  /** net_received_amount — líquido recebido. */
  net: number;
  /** transaction_amount_refunded — estornado. */
  estorno: number;
  /** money_release_date — quando o saldo é liberado (ISO). */
  releaseDate: string | null;
}

export interface VendaItemRow {
  ml_item_id: string | null;
  variation_id: number | null;
  titulo: string | null;
  codigo: string | null;
  /** Cor vendida (variation_attributes COLOR do pedido). null = sem variação/cor. */
  cor: string | null;
  /** EAN/GTIN do produto (resolvido do catálogo). null = não mapeado. */
  ean: string | null;
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
  buyer?: { id?: number | string | null; nickname?: string | null; first_name?: string | null; last_name?: string | null } | null;
  shipping?: { id?: number | string | null } | null;
  order_items?: Array<{
    item?: {
      id?: string | null; title?: string | null; variation_id?: number | string | null;
      variation_attributes?: Array<{ id?: string | null; name?: string | null; value_name?: string | null }> | null;
    } | null;
    quantity?: number | null;
    unit_price?: number | null;
    sale_fee?: number | null;
  }> | null;
  payments?: Array<{ id?: number | string | null } | null> | null;
}

export interface MapearOpts {
  /** ml_item_id dos anúncios gerenciados pelo PubliAI (define is_publiai). */
  idsPubliai: Set<string>;
  /** Resolve o código do catálogo a partir do (ml_item_id, variation_id). null = não mapeado. */
  codigoResolver: (mlItemId: string | null, variationId: number | null) => string | null;
  /** Resolve o EAN/GTIN a partir do (ml_item_id, variation_id). null = não mapeado. */
  eanResolver?: (mlItemId: string | null, variationId: number | null) => string | null;
  /** normGtin → {codigo, ean} do catálogo do vendedor — casa vendas de catálogo (item.id de catálogo). */
  infoPorGtin?: Map<string, { codigo: string | null; ean: string | null }>;
  /** ml_item_id → GTIN do item (buscado via /items), p/ o fallback por GTIN. */
  gtinPorItem?: Map<string, string>;
  /** paymentId → dados do MP (líquido, estorno, data de liberação). Define o líquido/estorno/
   *  liberação reais da venda; sem entrada → cai na estimativa (ADR-0038). */
  liquidoPorPayment?: Map<string, DadosPagamentoMP>;
  /** Custo de envio pago pelo vendedor (vem do shipment, opcional). */
  freteVendedor?: number | null;
}

/** Extrai a cor (variation_attributes COLOR) de um item do pedido. null se ausente. */
function extrairCor(attrs: Array<{ id?: string | null; name?: string | null; value_name?: string | null }> | null | undefined): string | null {
  for (const a of attrs ?? []) {
    if (a?.id === 'COLOR' || /cor/i.test(a?.name ?? '')) return a?.value_name ?? null;
  }
  return null;
}

/**
 * Extrai cidade/UF do endereço de entrega de um shipment do ML (/shipments/{id} com `x-format-new`).
 * No formato novo o endereço fica em `destination.shipping_address`; mantém fallback ao
 * `receiver_address` (formato antigo). A UF vem como `state.id` "BR-SP" — devolvemos sem o prefixo
 * ("SP"). Pura e defensiva: cidade/uf null quando ausente.
 */
export function extrairGeo(shipment: unknown): { cidade: string | null; uf: string | null } {
  type Endereco = { city?: { name?: string | null } | null; state?: { id?: string | null } | null } | null;
  const s = shipment as {
    destination?: { shipping_address?: Endereco } | null;
    receiver_address?: Endereco;
  } | null | undefined;
  const addr = s?.destination?.shipping_address ?? s?.receiver_address ?? null;
  const cidade = addr?.city?.name ?? null;
  const stateId = addr?.state?.id ?? null;
  const uf = typeof stateId === 'string' ? stateId.replace(/^BR-/, '') : null;
  return { cidade: cidade ?? null, uf };
}

/** Nome do destinatário do envio (shipment, x-format-new). null quando ausente. Pura. */
export function extrairReceiverNome(shipment: unknown): string | null {
  const s = shipment as { destination?: { receiver_name?: string | null } | null } | null | undefined;
  const nome = s?.destination?.receiver_name ?? null;
  return typeof nome === 'string' && nome.trim() ? nome.trim() : null;
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

    // 1) Match direto pelo ml_item_id (anúncio do próprio vendedor).
    let itemPubliai = mlItemId != null && opts.idsPubliai.has(mlItemId);
    let codigo = itemPubliai ? opts.codigoResolver(mlItemId, variationId) : null;
    let ean = itemPubliai && opts.eanResolver ? opts.eanResolver(mlItemId, variationId) : null;

    // 2) Fallback por GTIN: venda de catálogo traz item.id de catálogo (não casa por id),
    //    mas o GTIN do produto bate com o catálogo do vendedor → é PubliAI (igual financeiro).
    const gtin = mlItemId ? opts.gtinPorItem?.get(mlItemId) ?? null : null;
    if (!itemPubliai && gtin && opts.infoPorGtin) {
      const info = opts.infoPorGtin.get(normGtin(gtin));
      if (info) { itemPubliai = true; codigo = info.codigo; ean = info.ean ?? gtin; }
    }
    if (!ean && gtin) ean = gtin; // mostra o EAN mesmo p/ itens fora do catálogo

    if (itemPubliai) isPubliai = true;
    return {
      ml_item_id: mlItemId,
      variation_id: variationId,
      titulo: oi?.item?.title ?? null,
      codigo,
      cor: extrairCor(oi?.item?.variation_attributes),
      ean,
      quantity: Number(oi?.quantity ?? 0),
      unit_price: Number(oi?.unit_price ?? 0),
      sale_fee: saleFee,
      is_publiai: itemPubliai,
    };
  });

  saleFeeTotal = round2(saleFeeTotal);
  const total = Number(pedido.total_amount ?? 0);
  const frete = opts.freteVendedor ?? null;

  // Líquido = estimativa econômica `bruto − comissão − frete real do vendedor` (calcularLiquido).
  // NÃO usamos o net_received_amount do MP: em envio cross-docking (`shp_cross_docking`) o pagamento
  // do item é debitado o frete CHEIO da etiqueta e a parte do comprador volta num pagamento à parte
  // (`marketplace_shipment`); além disso a comissão é cobrada FORA do pagamento (fee_details vazio
  // na conta). Logo o net isolado desconta frete a mais e ignora a comissão → markup falso. O frete
  // real do vendedor vem de `/shipments/{id}/costs` (senders[].cost), em `opts.freteVendedor`.
  // Estorno/liberação seguem vindo do MP (informação confiável por pagamento). Ver ADR-0042.
  let estorno: number | null = null;
  let releaseDate: string | null = null;
  if (opts.liquidoPorPayment) {
    let somaEstorno = 0, achou = false;
    for (const pg of pedido.payments ?? []) {
      const id = pg?.id != null ? String(pg.id) : null;
      const d = id ? opts.liquidoPorPayment.get(id) : undefined;
      if (d) {
        somaEstorno += d.estorno;
        if (d.releaseDate && (!releaseDate || d.releaseDate > releaseDate)) releaseDate = d.releaseDate;
        achou = true;
      }
    }
    if (achou) estorno = round2(somaEstorno);
  }

  const venda: VendaRow = {
    order_id: Number(pedido.id),
    pack_id: num(pedido.pack_id ?? null),
    status: pedido.status ?? 'unknown',
    status_detail: pedido.status_detail ?? null,
    date_created: pedido.date_created ?? null,
    date_closed: pedido.date_closed ?? null,
    comprador_id: num(pedido.buyer?.id ?? null),
    comprador_nick: pedido.buyer?.nickname ?? null,
    comprador_nome: [pedido.buyer?.first_name, pedido.buyer?.last_name].filter(Boolean).join(' ').trim() || null,
    total_amount: round2(total),
    paid_amount: num(pedido.paid_amount ?? null),
    sale_fee_total: saleFeeTotal,
    frete_vendedor: frete,
    liquido: calcularLiquido(total, saleFeeTotal, frete),
    estorno,
    money_release_date: releaseDate,
    currency: pedido.currency_id ?? 'BRL',
    shipping_id: num(pedido.shipping?.id ?? null),
    is_publiai: isPubliai,
  };

  return { venda, itens };
}
