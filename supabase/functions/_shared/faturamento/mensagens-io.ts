// IO de mensagens pós-venda (ADR-0067): chamadas à API do ML e persistência. Não testado por vitest.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { extrairMensagens, mapearMensagem, type MensagemML } from './mensagem-mapper.ts';

const API = 'https://api.mercadolibre.com';

/** GET /messages/packs/{pack}/sellers/{seller}?tag=post_sale. [] em erro (não trava o worker). */
export async function buscarMensagensPack(
  token: string, packId: string | number, sellerId: string | number,
): Promise<MensagemML[]> {
  const url = `${API}/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale&mark_as_read=false`;
  try {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return [];
    return extrairMensagens(await resp.json());
  } catch { return []; }
}

/** Upsert idempotente das mensagens de um pack. Retorna nº de novas RECEBIDAS (para alerta). */
export async function upsertMensagens(
  admin: SupabaseClient,
  userId: string,
  orgId: string | null,
  packId: string | number,
  orderId: string | number | null,
  itemTitulo: string | null,
  sellerId: string | number,
  msgs: MensagemML[],
): Promise<{ novasRecebidas: number }> {
  const rows = msgs.map((m) => {
    const r = mapearMensagem(m, sellerId);
    return {
      user_id: userId,
      org_id: orgId,
      pack_id: String(packId),
      order_id: orderId != null ? String(orderId) : null,
      item_titulo: itemTitulo,
      raw: m as unknown as Record<string, unknown>,
      atualizado_em: new Date().toISOString(),
      ...r,
    };
  }).filter((r) => r.message_id);
  if (rows.length === 0) return { novasRecebidas: 0 };

  // Quais já conhecíamos, para contar só as novas recebidas.
  const ids = rows.map((r) => r.message_id);
  const { data: existentes } = await admin.from('ml_mensagens')
    .select('message_id').eq('user_id', userId).in('message_id', ids);
  const conhecidos = new Set((existentes ?? []).map((e: { message_id: string }) => e.message_id));

  await admin.from('ml_mensagens').upsert(rows, { onConflict: 'user_id,message_id' });

  const novasRecebidas = rows.filter((r) => r.direcao === 'recebida' && !conhecidos.has(r.message_id)).length;
  return { novasRecebidas };
}

/** Envia mensagem ao comprador e LANÇA em erro (reply interativo precisa avisar o operador —
 *  diferente de `enviarMensagemPedido`, que engole erro no fluxo fire-and-forget de boas-vindas). */
export async function responderMensagemPedido(
  token: string, packId: string | number, sellerId: string | number, texto: string,
): Promise<void> {
  const resp = await fetch(`${API}/messages/packs/${packId}/sellers/${sellerId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texto, message_attachments: null }),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`ML /messages ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
}

/** order_id + título do pedido dono do pack (pack_id ou, se solo, o próprio order_id). */
export async function resolverMetaPack(
  admin: SupabaseClient, userId: string, packId: string | number,
): Promise<{ orderId: string | null; itemTitulo: string | null }> {
  const { data } = await admin.from('ml_vendas')
    .select('order_id, ml_vendas_itens(titulo)')
    .eq('user_id', userId)
    .or(`pack_id.eq.${packId},order_id.eq.${packId}`)
    .limit(1).maybeSingle();
  const v = data as { order_id?: number; ml_vendas_itens?: Array<{ titulo: string | null }> } | null;
  return { orderId: v?.order_id != null ? String(v.order_id) : null, itemTitulo: v?.ml_vendas_itens?.[0]?.titulo ?? null };
}

export interface PackVenda { packId: string; orderId: string; itemTitulo: string | null }

/** Packs dos pedidos já conhecidos (backfill). Sem pack_id, usa o próprio order_id (pedido solo). */
export async function listarPacksDeVendas(admin: SupabaseClient, userId: string, limite = 200): Promise<PackVenda[]> {
  const { data } = await admin.from('ml_vendas')
    .select('order_id, pack_id, ml_vendas_itens(titulo)')
    .eq('user_id', userId)
    .order('date_closed', { ascending: false })
    .limit(limite);
  const vistos = new Set<string>();
  const out: PackVenda[] = [];
  for (const v of (data ?? []) as Array<{ order_id: number; pack_id: number | null; ml_vendas_itens?: Array<{ titulo: string | null }> }>) {
    const packId = String(v.pack_id ?? v.order_id);
    if (vistos.has(packId)) continue;
    vistos.add(packId);
    out.push({ packId, orderId: String(v.order_id), itemTitulo: v.ml_vendas_itens?.[0]?.titulo ?? null });
  }
  return out;
}
