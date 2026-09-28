// IO de mensagens pós-venda (ADR-0067): chamadas à API do ML e persistência. Não testado por vitest.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { extrairMensagens, mapearMensagem, type MensagemML } from './mensagem-mapper.ts';
import { enviarMsgML } from '../ml/mensagem.ts';

const API = 'https://api.mercadolibre.com';

export interface MetaPack {
  orderId: string | null;
  itemId: string | null;
  itemTitulo: string | null;
  compradorNome: string | null;
  compradorNick: string | null;
  orderStatus: string | null;
}

export const ERRO_PEDIDO_CANCELADO = 'Não é possível responder porque o pedido foi cancelado.';
export const CODIGO_PEDIDO_CANCELADO = 'pedido_cancelado';

// O ML bloqueia o chat pós-venda enquanto há reclamação em mediação; a resposta só sai por lá.
export const ERRO_EM_MEDIACAO =
  'o pedido está em mediação no Mercado Livre. Responda dentro da reclamação, no próprio ML.';

export const pedidoCancelado = (status: string | null | undefined): boolean => status === 'cancelled';

export function mensagemErroEnvioML(status: number, corpo: string): string {
  if (status === 403 && corpo.includes('blocked_by_cancelled_order')) {
    return ERRO_PEDIDO_CANCELADO;
  }
  if (status === 403 && corpo.includes('blocked_by_mediation')) {
    return ERRO_EM_MEDIACAO;
  }
  return `ML /messages ${status}: ${corpo.slice(0, 200)}`;
}

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

/** Mesma leitura, ESTRITA (ADR-0173): 403/404 (pack sem mensagens/sem permissão) → []; qualquer
 *  outro não-2xx (429/5xx) ou erro de rede → lança — o worker precisa distinguir "não há nada"
 *  de "a leitura falhou", que hoje voltam ambos como []. */
export async function buscarMensagensPackEstrito(
  token: string, packId: string | number, sellerId: string | number, f: typeof fetch = fetch,
): Promise<MensagemML[]> {
  const url = `${API}/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale&mark_as_read=false`;
  const resp = await f(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (resp.status === 403 || resp.status === 404) return [];
  if (!resp.ok) throw new Error(`ML /messages/packs ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return extrairMensagens(await resp.json());
}

function montarLinhasMensagens(
  userId: string, orgId: string | null, packId: string | number, meta: MetaPack, sellerId: string | number, msgs: MensagemML[],
) {
  // null significa que a fonte atual não sabe o valor; omitir a coluna no upsert preserva o
  // snapshot já completo de uma sincronização anterior (novas linhas continuam com null no DB).
  const metadata = {
    ...(meta.orderId != null ? { order_id: meta.orderId } : {}),
    ...(meta.itemId != null ? { item_id: meta.itemId } : {}),
    ...(meta.itemTitulo != null ? { item_titulo: meta.itemTitulo } : {}),
    ...(meta.compradorNome != null ? { comprador_nome: meta.compradorNome } : {}),
    ...(meta.compradorNick != null ? { comprador_nick: meta.compradorNick } : {}),
    ...(meta.orderStatus != null ? { order_status: meta.orderStatus } : {}),
  };
  return msgs.map((m) => {
    const r = mapearMensagem(m, sellerId);
    return {
      user_id: userId,
      org_id: orgId,
      pack_id: String(packId),
      ...metadata,
      raw: m as unknown as Record<string, unknown>,
      atualizado_em: new Date().toISOString(),
      ...r,
    };
  }).filter((r) => r.message_id);
}

/** Upsert idempotente das mensagens de um pack. Retorna nº de novas RECEBIDAS (para alerta). */
export async function upsertMensagens(
  admin: SupabaseClient,
  userId: string,
  orgId: string | null,
  packId: string | number,
  meta: MetaPack,
  sellerId: string | number,
  msgs: MensagemML[],
): Promise<{ novasRecebidas: number }> {
  const rows = montarLinhasMensagens(userId, orgId, packId, meta, sellerId, msgs);
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

/** Mesmo upsert, ESTRITO (ADR-0173): `error` de QUALQUER um dos dois upserts lança — hoje ambos
 *  são ignorados, e uma falha silenciosa deixaria a pendência do worker limpa sem gravar nada. */
export async function upsertMensagensEstrito(
  admin: SupabaseClient,
  userId: string,
  orgId: string | null,
  packId: string | number,
  meta: MetaPack,
  sellerId: string | number,
  msgs: MensagemML[],
): Promise<{ novasRecebidas: number }> {
  const rows = montarLinhasMensagens(userId, orgId, packId, meta, sellerId, msgs);
  if (rows.length === 0) return { novasRecebidas: 0 };

  const { data: inseridas, error: erroNovas } = await admin.from('ml_mensagens')
    .upsert(rows, { onConflict: 'user_id,message_id', ignoreDuplicates: true })
    .select('message_id, direcao');
  if (erroNovas) throw new Error(`upsert ml_mensagens (novas): ${erroNovas.message}`);
  const novasRecebidas = (inseridas ?? []).filter((r) => r.direcao === 'recebida').length;

  const { error: erroAtualiza } = await admin.from('ml_mensagens').upsert(rows, { onConflict: 'user_id,message_id' });
  if (erroAtualiza) throw new Error(`upsert ml_mensagens (atualização): ${erroAtualiza.message}`);

  return { novasRecebidas };
}

/** Envia mensagem ao comprador e LANÇA em erro (reply interativo precisa avisar o operador —
 *  diferente de `enviarMensagemPedido`, que engole erro no fluxo fire-and-forget de boas-vindas). */
export async function responderMensagemPedido(
  token: string, packId: string | number, sellerId: string | number, buyerId: string | number, texto: string,
): Promise<void> {
  const resp = await enviarMsgML(token, packId, sellerId, buyerId, texto);
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => '');
    throw new Error(mensagemErroEnvioML(resp.status, corpo));
  }
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

/** Metadados do pedido dono do pack (pack_id ou, se solo, o próprio order_id). */
export async function resolverMetaPack(
  admin: SupabaseClient, userId: string, packId: string | number,
): Promise<MetaPack> {
  const { data, error } = await admin.from('ml_vendas')
    .select('order_id, status, comprador_nome, comprador_nick, ml_vendas_itens(ml_item_id, titulo)')
    .eq('user_id', userId)
    .or(`pack_id.eq.${packId},order_id.eq.${packId}`)
    .limit(1).maybeSingle();
  if (error) throw new Error(`resolver meta pack: ${error.message}`);
  const v = data as {
    order_id?: number | string | null;
    status?: string | null;
    comprador_nome?: string | null;
    comprador_nick?: string | null;
    ml_vendas_itens?: Array<{ ml_item_id: string | null; titulo: string | null }>;
  } | null;
  const item = v?.ml_vendas_itens?.[0];
  return {
    orderId: v?.order_id != null ? String(v.order_id) : null,
    itemId: item?.ml_item_id ?? null,
    itemTitulo: item?.titulo ?? null,
    compradorNome: v?.comprador_nome ?? null,
    compradorNick: v?.comprador_nick ?? null,
    orderStatus: v?.status ?? null,
  };
}

export interface PackVenda extends MetaPack { packId: string }

function mapearPacksDeVendas(data: unknown): PackVenda[] {
  const vistos = new Set<string>();
  const out: PackVenda[] = [];
  for (const v of (data ?? []) as Array<{
    order_id: number | string; pack_id: number | string | null; status?: string | null;
    comprador_nome?: string | null; comprador_nick?: string | null;
    ml_vendas_itens?: Array<{ ml_item_id: string | null; titulo: string | null }>;
  }>) {
    const packId = String(v.pack_id ?? v.order_id);
    if (vistos.has(packId)) continue;
    vistos.add(packId);
    const item = v.ml_vendas_itens?.[0];
    out.push({
      packId,
      orderId: String(v.order_id),
      itemId: item?.ml_item_id ?? null,
      itemTitulo: item?.titulo ?? null,
      compradorNome: v.comprador_nome ?? null,
      compradorNick: v.comprador_nick ?? null,
      orderStatus: v.status ?? null,
    });
  }
  return out;
}

/** Packs dos pedidos já conhecidos (backfill). Sem pack_id, usa o próprio order_id (pedido solo). */
export async function listarPacksDeVendas(admin: SupabaseClient, userId: string, limite = 200): Promise<PackVenda[]> {
  const { data } = await admin.from('ml_vendas')
    .select('order_id, pack_id, status, comprador_nome, comprador_nick, ml_vendas_itens(ml_item_id, titulo)')
    .eq('user_id', userId)
    .order('date_closed', { ascending: false })
    .limit(limite);
  return mapearPacksDeVendas(data);
}

/** Mesma leitura, ESTRITA (ADR-0173): `error` do select lança em vez de tratar como "sem packs". */
export async function listarPacksDeVendasEstrito(admin: SupabaseClient, userId: string, limite = 200): Promise<PackVenda[]> {
  const { data, error } = await admin.from('ml_vendas')
    .select('order_id, pack_id, status, comprador_nome, comprador_nick, ml_vendas_itens(ml_item_id, titulo)')
    .eq('user_id', userId)
    .order('date_closed', { ascending: false })
    .limit(limite);
  if (error) throw new Error(`listar packs de vendas: ${error.message}`);
  return mapearPacksDeVendas(data);
}

export async function marcarConversaCancelada(
  admin: SupabaseClient, orgId: string, packId: string | number, userId?: string | null,
): Promise<void> {
  const { error } = await admin.from('ml_mensagens')
    .update({ order_status: 'cancelled' })
    .eq('org_id', orgId).eq('pack_id', String(packId));
  if (error) throw new Error(`marcar conversa cancelada: ${error.message}`);

  const { data: venda } = await admin.from('ml_vendas')
    .select('order_id').eq('org_id', orgId)
    .or(`pack_id.eq.${packId},order_id.eq.${packId}`).limit(1).maybeSingle();
  if (venda?.order_id != null) {
    const upd = admin.from('ml_vendas').update({ status: 'cancelled' })
      .eq('org_id', orgId).eq('order_id', venda.order_id);
    if (userId) upd.eq('user_id', userId);
    const { error: vendaErr } = await upd;
    if (vendaErr) throw new Error(`marcar venda cancelada: ${vendaErr.message}`);
  }
}
