// IO do módulo Faturamento (ADR-0037): chamadas à API do ML e persistência.
// Não testado por vitest (usa Deno/supabase-js); a lógica pura fica em venda.ts.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { mapearPedidoParaVenda, normGtin, extrairGeo, extrairReceiverNome, type PedidoML, type VendaItemRow, type DadosPagamentoMP } from './venda.ts';
import { round2 } from '../dinheiro.ts';

const API = 'https://api.mercadolibre.com';

/** Resolve o user_id local a partir do ml_user_id (vendedor no ML). null se desconhecido. */
export async function resolverUserId(admin: SupabaseClient, mlUserId: number | string): Promise<string | null> {
  const { data } = await admin.from('ml_credentials')
    .select('user_id').eq('ml_user_id', String(mlUserId)).maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

export interface Catalogo {
  idsPubliai: Set<string>;
  codigoResolver: (itemId: string | null, varId: number | null) => string | null;
  eanResolver: (itemId: string | null, varId: number | null) => string | null;
  /** normGtin → {codigo, ean} do catálogo — casa vendas de catálogo por GTIN. */
  infoPorGtin: Map<string, { codigo: string | null; ean: string | null }>;
}

/** Resolvedores (código/EAN) por (ml_item_id, variation_id) + conjunto de ids do PubliAI. */
export async function carregarCatalogo(admin: SupabaseClient, userId: string): Promise<Catalogo> {
  const { data: familias } = await admin.from('familias')
    .select('id, ml_item_id, codigo_pai').eq('user_id', userId).not('ml_item_id', 'is', null);
  const famPorId = new Map<string, { mlItemId: string; codigoPai: string | null }>();
  const idsPubliai = new Set<string>();
  for (const f of familias ?? []) {
    famPorId.set(f.id as string, { mlItemId: f.ml_item_id as string, codigoPai: f.codigo_pai as string | null });
    idsPubliai.add(f.ml_item_id as string);
  }
  const { data: variacoes } = await admin.from('variacoes')
    .select('familia_id, codigo, gtin, ml_variation_id').eq('user_id', userId);
  // chave "itemId:varId" → valor da variação; fallback "itemId" → primeiro valor da família.
  const codPorVar = new Map<string, string>(), codPorItem = new Map<string, string>();
  const eanPorVar = new Map<string, string>(), eanPorItem = new Map<string, string>();
  const infoPorGtin = new Map<string, { codigo: string | null; ean: string | null }>();
  for (const v of variacoes ?? []) {
    const fam = famPorId.get(v.familia_id as string);
    if (!fam) continue;
    const cod = v.codigo as string | null, ean = v.gtin as string | null;
    if (cod && v.ml_variation_id != null) codPorVar.set(`${fam.mlItemId}:${v.ml_variation_id}`, cod);
    if (cod && !codPorItem.has(fam.mlItemId)) codPorItem.set(fam.mlItemId, cod);
    if (ean && v.ml_variation_id != null) eanPorVar.set(`${fam.mlItemId}:${v.ml_variation_id}`, ean);
    if (ean && !eanPorItem.has(fam.mlItemId)) eanPorItem.set(fam.mlItemId, ean);
    if (ean && !infoPorGtin.has(normGtin(ean))) infoPorGtin.set(normGtin(ean), { codigo: cod, ean });
  }
  for (const [, fam] of famPorId) {
    if (fam.codigoPai && !codPorItem.has(fam.mlItemId)) codPorItem.set(fam.mlItemId, fam.codigoPai);
  }
  const mk = (porVar: Map<string, string>, porItem: Map<string, string>) =>
    (itemId: string | null, varId: number | null): string | null => {
      if (!itemId) return null;
      if (varId != null) { const x = porVar.get(`${itemId}:${varId}`); if (x) return x; }
      return porItem.get(itemId) ?? null;
    };
  return { idsPubliai, codigoResolver: mk(codPorVar, codPorItem), eanResolver: mk(eanPorVar, eanPorItem), infoPorGtin };
}

/** GET /orders/{id}. null em erro. */
export async function buscarPedido(token: string, orderId: string): Promise<PedidoML | null> {
  const resp = await fetch(`${API}/orders/${orderId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return null;
  return await resp.json() as PedidoML;
}

/** Custo de frete pago pelo vendedor via /shipments/{id}/costs. null em erro/ausente. */
export async function buscarFreteVendedor(token: string, shippingId: number | string | null): Promise<number | null> {
  if (shippingId == null) return null;
  try {
    const resp = await fetch(`${API}/shipments/${shippingId}/costs`, {
      headers: { Authorization: `Bearer ${token}`, 'x-format-new': 'true' },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const senders = Array.isArray(data?.senders) ? data.senders : [];
    const soma = senders.reduce((acc: number, s: { cost?: number }) => acc + Number(s?.cost ?? 0), 0);
    return round2(soma);
  } catch {
    return null;
  }
}

/** Status do envio + geografia (cidade/UF do receiver_address) via /shipments/{id}. null em erro. */
export async function buscarShipment(token: string, shippingId: number | string | null): Promise<{
  status: string | null; substatus: string | null; tracking: string | null; logistic: string | null;
  cidade: string | null; uf: string | null; receiverNome: string | null;
} | null> {
  if (shippingId == null) return null;
  try {
    const resp = await fetch(`${API}/shipments/${shippingId}`, {
      headers: { Authorization: `Bearer ${token}`, 'x-format-new': 'true' },
    });
    if (!resp.ok) return null;
    const s = await resp.json();
    const geo = extrairGeo(s);
    return {
      status: s?.status ?? null,
      substatus: s?.substatus ?? null,
      tracking: s?.tracking_number ?? null,
      logistic: s?.logistic?.type ?? s?.logistic_type ?? null,
      cidade: geo.cidade,
      uf: geo.uf,
      receiverNome: extrairReceiverNome(s),
    };
  } catch {
    return null;
  }
}

/** Varre /orders/search do vendedor no período. Retorna pedidos completos. */
export async function buscarPedidosPeriodo(
  token: string,
  intervalo: { desde: string; ate: string },
): Promise<PedidoML[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const meResp = await fetch(`${API}/users/me`, { headers });
  if (!meResp.ok) throw new Error(`ML /users/me ${meResp.status}`);
  const seller = (await meResp.json())?.id;
  if (!seller) throw new Error('ML: seller id ausente');

  const pedidos: PedidoML[] = [];
  const limit = 50;
  let offset = 0;
  while (offset < 5000) {
    const params = new URLSearchParams({
      seller: String(seller),
      'order.date_created.from': intervalo.desde,
      'order.date_created.to': intervalo.ate,
      sort: 'date_desc',
      offset: String(offset),
      limit: String(limit),
    });
    const resp = await fetch(`${API}/orders/search?${params}`, { headers });
    if (!resp.ok) {
      if (offset === 0) throw new Error(`ML /orders ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      break;
    }
    const data = await resp.json();
    const results: PedidoML[] = Array.isArray(data?.results) ? data.results : [];
    pedidos.push(...results);
    const total = Number(data?.paging?.total ?? pedidos.length);
    offset += limit;
    if (results.length === 0 || offset >= total) break;
  }
  return pedidos;
}

/** Upsert de uma venda + substituição dos itens. Idempotente por (user_id, order_id). */
export async function upsertVenda(
  admin: SupabaseClient,
  userId: string,
  pedido: PedidoML,
  opts: { freteVendedor?: number | null;
          idsPubliai: Set<string>; codigoResolver: (i: string | null, v: number | null) => string | null;
          eanResolver?: (i: string | null, v: number | null) => string | null;
          shipment?: { status: string | null; substatus: string | null; tracking: string | null; logistic: string | null; cidade: string | null; uf: string | null; receiverNome: string | null } | null;
          infoPorGtin?: Map<string, { codigo: string | null; ean: string | null }>;
          gtinPorItem?: Map<string, string>;
          liquidoPorPayment?: Map<string, DadosPagamentoMP> },
): Promise<{ vendaId: string; novaPaga: boolean; itens: VendaItemRow[] }> {
  const { venda, itens } = mapearPedidoParaVenda(pedido, {
    idsPubliai: opts.idsPubliai, codigoResolver: opts.codigoResolver, eanResolver: opts.eanResolver,
    infoPorGtin: opts.infoPorGtin, gtinPorItem: opts.gtinPorItem, liquidoPorPayment: opts.liquidoPorPayment,
    freteVendedor: opts.freteVendedor,
  });
  // Estado anterior (para detectar "nova venda paga" e não realertar).
  const { data: anterior } = await admin.from('ml_vendas')
    .select('id, status').eq('user_id', userId).eq('order_id', venda.order_id).maybeSingle();

  const row = {
    user_id: userId,
    ...venda,
    comprador_nome: venda.comprador_nome,
    raw: pedido as unknown as Record<string, unknown>,
    shipping_status: opts.shipment?.status ?? null,
    shipping_substatus: opts.shipment?.substatus ?? null,
    tracking_number: opts.shipment?.tracking ?? null,
    shipping_logistic: opts.shipment?.logistic ?? null,
    cidade: opts.shipment?.cidade ?? null,
    uf: opts.shipment?.uf ?? null,
    atualizado_em: new Date().toISOString(),
  };
  const { data: up, error } = await admin.from('ml_vendas')
    .upsert(row, { onConflict: 'user_id,order_id' }).select('id').single();
  if (error) throw new Error(`upsert ml_vendas: ${error.message}`);
  const vendaId = up!.id as string;

  // Substitui os itens. Idempotente: unique (venda_id, ml_item_id, variation_id) impede
  // duplicata quando dois syncs do mesmo pedido correm concorrentes (ver plans/012).
  await admin.from('ml_vendas_itens').delete().eq('venda_id', vendaId);
  if (itens.length > 0) {
    const { error: itensErr } = await admin.from('ml_vendas_itens').upsert(
      itens.map((i: VendaItemRow) => ({ user_id: userId, venda_id: vendaId, ...i })),
      { onConflict: 'venda_id,ml_item_id,variation_id' },
    );
    if (itensErr) throw new Error(`upsert ml_vendas_itens: ${itensErr.message}`);
  }

  const eraPaga = anterior?.status === 'paid';
  const novaPaga = venda.status === 'paid' && !eraPaga;
  return { vendaId, novaPaga, itens };
}
