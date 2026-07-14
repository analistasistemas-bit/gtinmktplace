// IO de mensagens pós-venda (ADR-0067): chamadas à API do ML e persistência. Não testado por vitest.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { extrairMensagens, mapearMensagem, type MensagemML } from './mensagem-mapper.ts';
import { enviarMsgML } from '../ml/mensagem.ts';

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

  // ignoreDuplicates: só as linhas efetivamente INSERIDAS (novas) voltam no .select() — DO NOTHING
  // no conflito, então não há race de check-then-act entre execuções concorrentes do mesmo pack.
  const { data: inseridas } = await admin.from('ml_mensagens')
    .upsert(rows, { onConflict: 'user_id,message_id', ignoreDuplicates: true })
    .select('message_id, direcao');
  const novasRecebidas = (inseridas ?? []).filter((r) => r.direcao === 'recebida').length;

  // 2ª passada: upsert de verdade (sem ignoreDuplicates) para as existentes continuarem
  // recebendo raw/atualizado_em/item_titulo atualizados — a 1ª não escreve nada nelas.
  await admin.from('ml_mensagens').upsert(rows, { onConflict: 'user_id,message_id' });

  return { novasRecebidas };
}

/** Envia mensagem ao comprador e LANÇA em erro (reply interativo precisa avisar o operador —
 *  diferente de `enviarMensagemPedido`, que engole erro no fluxo fire-and-forget de boas-vindas). */
export async function responderMensagemPedido(
  token: string, packId: string | number, sellerId: string | number, buyerId: string | number, texto: string,
): Promise<void> {
  const resp = await enviarMsgML(token, packId, sellerId, buyerId, texto);
  if (!resp.ok) throw new Error(`ML /messages ${resp.status}: ${(await resp.text().catch(() => '')).slice(0, 200)}`);
}

/** user_id do comprador no pack, lido de uma mensagem `recebida` já sincronizada — o `from` de
 *  uma recebida é, por definição, o comprador (mesma regra de `mapearMensagem`). Necessário para
 *  o campo `to` do POST do ML, que não é montado em nenhum outro lugar. */
export async function resolverCompradorId(
  admin: SupabaseClient, orgId: string, packId: string | number,
): Promise<string | null> {
  const { data } = await admin.from('ml_mensagens')
    .select('raw')
    .eq('org_id', orgId).eq('pack_id', String(packId)).eq('direcao', 'recebida')
    .limit(1).maybeSingle();
  const id = (data as { raw?: MensagemML } | null)?.raw?.from?.user_id;
  return id != null ? String(id) : null;
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
