// Responde mensagem pós-venda no ML (ADR-0067). Chamada pelo frontend (JWT). Texto do operador
// (podendo ter sido sugerido por IA) — revisão humana sempre. Usa a conta ML da própria org.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import { buscarMensagensPack, upsertMensagens, resolverMetaPack, responderMensagemPedido, resolverCompradorId } from '../_shared/faturamento/mensagens-io.ts';

interface Body { pack_id?: string; text?: string }

const erro = (msg: string, status: number) => new Response(JSON.stringify({ ok: false, erro: msg }), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: Body;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  const packId = String(body.pack_id ?? '').trim();
  const text = (body.text ?? '').trim();
  if (!packId || !text) return erro('pack_id e text obrigatórios', 400);
  if (!/^\d+$/.test(packId)) return erro('pack_id inválido', 400);
  if (text.length > 350) return erro('Mensagem excede 350 caracteres.', 400); // limite do ML no pós-venda.

  const admin = adminClient();
  const { data: cxRow } = await admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at, criado_por')
    .eq('org_id', orgId).eq('canal', 'mercado_livre').maybeSingle();
  const conexao = mapearConexao(cxRow ?? null);
  if (!conexao || !conexao.contaExternaId) return erro('Conta ML não conectada.', 400);
  const sellerId = conexao.contaExternaId;
  const dono = (cxRow?.criado_por as string | null) ?? null; // mesma chave user_id do sync/backfill.

  let token: string;
  try { token = await getValidAccessTokenConexao(conexao); }
  catch { return erro('Conta ML não conectada.', 400); }

  const buyerId = await resolverCompradorId(admin, orgId, packId);
  if (!buyerId) return erro('Não foi possível identificar o comprador desta conversa.', 400);

  try {
    await responderMensagemPedido(token, packId, sellerId, buyerId, text);
  } catch (e) {
    return erro((e as Error).message, 502);
  }

  // Re-busca o pack (captura a mensagem enviada) e marca as recebidas como lidas (limpa o badge).
  if (dono) {
    const msgs = await buscarMensagensPack(token, packId, sellerId);
    if (msgs.length) {
      const { orderId, itemTitulo } = await resolverMetaPack(admin, dono, packId);
      await upsertMensagens(admin, dono, orgId, packId, orderId, itemTitulo, sellerId, msgs);
    }
    await admin.from('ml_mensagens').update({ lida: true, atualizado_em: new Date().toISOString() })
      .eq('user_id', dono).eq('pack_id', packId).eq('direcao', 'recebida').eq('lida', false);
  }

  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
