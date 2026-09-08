// Responde mensagem pós-venda no ML (ADR-0067). Chamada pelo frontend (JWT). Texto do operador
// (podendo ter sido sugerido por IA) — revisão humana sempre. Usa a conta ML da própria org.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import {
  buscarMensagensPack,
  pedidoCancelado,
  upsertMensagens,
  resolverMetaPack,
  responderMensagemPedido,
  resolverCompradorId,
  marcarConversaCancelada,
  ERRO_PEDIDO_CANCELADO,
  CODIGO_PEDIDO_CANCELADO,
} from '../_shared/faturamento/mensagens-io.ts';

interface Body { pack_id?: string; text?: string }

const erro = (msg: string, status: number, codigo?: string) => new Response(
  JSON.stringify({ ok: false, erro: msg, ...(codigo ? { codigo } : {}) }),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let orgId: string;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
try { ({ orgId } = context = await requireUserOrg(req, { access: 'write' })); }
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

  const meta = await resolverMetaPack(admin, dono ?? context.userId, packId);
  if (pedidoCancelado(meta.orderStatus)) {
    await marcarConversaCancelada(admin, orgId, packId, dono).catch((e) =>
      console.error('[responder-mensagem] falha ao marcar conversa cancelada:', e)
    );
    return erro(ERRO_PEDIDO_CANCELADO, 409, CODIGO_PEDIDO_CANCELADO);
  }

  let token: string;
  try { token = await getValidAccessTokenConexao(conexao); }
  catch { return erro('Conta ML não conectada.', 400); }

  const buyerId = await resolverCompradorId(admin, orgId, packId);
  if (!buyerId) return erro('Não foi possível identificar o comprador desta conversa.', 400);

  try {
    await responderMensagemPedido(token, packId, sellerId, buyerId, text);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === ERRO_PEDIDO_CANCELADO) {
      await marcarConversaCancelada(admin, orgId, packId, dono).catch((e) =>
        console.error('[responder-mensagem] falha ao marcar conversa cancelada:', e)
      );
      return erro(ERRO_PEDIDO_CANCELADO, 409, CODIGO_PEDIDO_CANCELADO);
    }
    await auditarOperacaoSuporte(admin, context, { type: 'pack', id: packId }, 'failed');
    return erro(msg, 502);
  }

  // Re-busca o pack (captura a mensagem enviada) e marca as recebidas como lidas (limpa o badge).
  if (dono) {
    const msgs = await buscarMensagensPack(token, packId, sellerId);
    if (msgs.length) {
      const meta = await resolverMetaPack(admin, dono, packId);
      await upsertMensagens(admin, dono, orgId, packId, meta, sellerId, msgs);
    }
    await admin.from('ml_mensagens').update({ lida: true, atualizado_em: new Date().toISOString() })
      .eq('user_id', dono).eq('pack_id', packId).eq('direcao', 'recebida').eq('lida', false);
  }

  await auditarOperacaoSuporte(admin, context, { type: 'pack', id: packId }, 'succeeded');
  return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
