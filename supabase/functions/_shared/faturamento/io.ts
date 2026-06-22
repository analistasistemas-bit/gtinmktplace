// IO do módulo Faturamento (ADR-0037): chamadas à API do ML e persistência.
// Não testado por vitest (usa Deno/supabase-js); a lógica pura fica em venda.ts.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { mapearPedidoParaVenda, type PedidoML, type VendaItemRow } from './venda.ts';

const API = 'https://api.mercadolibre.com';

/** Resolve o user_id local a partir do ml_user_id (vendedor no ML). null se desconhecido. */
export async function resolverUserId(admin: SupabaseClient, mlUserId: number | string): Promise<string | null> {
  const { data } = await admin.from('ml_credentials')
    .select('user_id').eq('ml_user_id', String(mlUserId)).maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

/** Map (ml_item_id, variation_id) → código do catálogo + conjunto de ids do PubliAI. */
export async function carregarCatalogo(admin: SupabaseClient, userId: string): Promise<{
  idsPubliai: Set<string>;
  codigoResolver: (itemId: string | null, varId: number | null) => string | null;
}> {
  const { data: familias } = await admin.from('familias')
    .select('id, ml_item_id, codigo_pai').eq('user_id', userId).not('ml_item_id', 'is', null);
  const famPorId = new Map<string, { mlItemId: string; codigoPai: string | null }>();
  const idsPubliai = new Set<string>();
  for (const f of familias ?? []) {
    famPorId.set(f.id as string, { mlItemId: f.ml_item_id as string, codigoPai: f.codigo_pai as string | null });
    idsPubliai.add(f.ml_item_id as string);
  }
  const { data: variacoes } = await admin.from('variacoes')
    .select('familia_id, codigo, ml_variation_id').eq('user_id', userId);
  // chave "itemId:varId" → codigo da variação; fallback "itemId" → codigo_pai da família.
  const porVar = new Map<string, string>();
  const porItem = new Map<string, string>();
  for (const v of variacoes ?? []) {
    const fam = famPorId.get(v.familia_id as string);
    if (!fam) continue;
    const cod = v.codigo as string | null;
    if (cod && v.ml_variation_id != null) porVar.set(`${fam.mlItemId}:${v.ml_variation_id}`, cod);
    if (cod && !porItem.has(fam.mlItemId)) porItem.set(fam.mlItemId, cod);
  }
  for (const [, fam] of famPorId) {
    if (fam.codigoPai && !porItem.has(fam.mlItemId)) porItem.set(fam.mlItemId, fam.codigoPai);
  }
  const codigoResolver = (itemId: string | null, varId: number | null): string | null => {
    if (!itemId) return null;
    if (varId != null) {
      const c = porVar.get(`${itemId}:${varId}`);
      if (c) return c;
    }
    return porItem.get(itemId) ?? null;
  };
  return { idsPubliai, codigoResolver };
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
    return Math.round(soma * 100) / 100;
  } catch {
    return null;
  }
}

/** Status do envio via /shipments/{id}. null em erro. */
export async function buscarShipment(token: string, shippingId: number | string | null): Promise<{
  status: string | null; substatus: string | null; tracking: string | null;
} | null> {
  if (shippingId == null) return null;
  try {
    const resp = await fetch(`${API}/shipments/${shippingId}`, {
      headers: { Authorization: `Bearer ${token}`, 'x-format-new': 'true' },
    });
    if (!resp.ok) return null;
    const s = await resp.json();
    return {
      status: s?.status ?? null,
      substatus: s?.substatus ?? null,
      tracking: s?.tracking_number ?? null,
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
  opts: { freteVendedor?: number | null; shipment?: { status: string | null; substatus: string | null; tracking: string | null } | null;
          idsPubliai: Set<string>; codigoResolver: (i: string | null, v: number | null) => string | null },
): Promise<{ vendaId: string; novaPaga: boolean }> {
  const { venda, itens } = mapearPedidoParaVenda(pedido, {
    idsPubliai: opts.idsPubliai, codigoResolver: opts.codigoResolver, freteVendedor: opts.freteVendedor,
  });
  // Estado anterior (para detectar "nova venda paga" e não realertar).
  const { data: anterior } = await admin.from('ml_vendas')
    .select('id, status').eq('user_id', userId).eq('order_id', venda.order_id).maybeSingle();

  const row = {
    user_id: userId,
    ...venda,
    raw: pedido as unknown as Record<string, unknown>,
    shipping_status: opts.shipment?.status ?? null,
    shipping_substatus: opts.shipment?.substatus ?? null,
    tracking_number: opts.shipment?.tracking ?? null,
    atualizado_em: new Date().toISOString(),
  };
  const { data: up, error } = await admin.from('ml_vendas')
    .upsert(row, { onConflict: 'user_id,order_id' }).select('id').single();
  if (error) throw new Error(`upsert ml_vendas: ${error.message}`);
  const vendaId = up!.id as string;

  // Substitui os itens (idempotente).
  await admin.from('ml_vendas_itens').delete().eq('venda_id', vendaId);
  if (itens.length > 0) {
    await admin.from('ml_vendas_itens').insert(
      itens.map((i: VendaItemRow) => ({ user_id: userId, venda_id: vendaId, ...i })),
    );
  }

  const eraPaga = anterior?.status === 'paid';
  const novaPaga = venda.status === 'paid' && !eraPaga;
  return { vendaId, novaPaga };
}
