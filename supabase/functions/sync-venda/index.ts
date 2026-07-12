// Worker de sincronização de venda (ADR-0037). Consome QStash (assinatura válida).
// Job: { user_id, order_id } (orders_v2) ou { user_id, shipping_id } (shipments).
// Faz fetch autenticado do pedido (+ shipment/frete), upsert e alerta Telegram em venda nova.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import {
  buscarPedido, buscarFreteVendedor, buscarShipment, carregarCatalogo, upsertVenda, resolverOrgPorUserId,
} from '../_shared/faturamento/io.ts';
import { carregarLiquidoMP, carregarGtinsFallback } from '../_shared/faturamento/enriquecimento.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { montarMensagemNovaVenda, montarMensagemConexaoBloqueada } from '../_shared/notificacoes/telegram.ts';
import { enviarMensagemPedido } from '../_shared/ml/mensagem.ts';
import { classificarErroML, MLApiError } from '../_shared/ml/erro-ml.ts';
import { registrarFalhaAuth, registrarSyncOk } from '../_shared/ml/liveness.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

interface Job { user_id?: string; order_id?: string; shipping_id?: string }

/** Classifica o erro (token ou fetch do recurso) e trata conforme a liveness (ADR-0069):
 * permanente-auth → registra + alerta (só na 1ª falha) e responde 200 (não re-tenta sozinho,
 * a conexão está morta); transiente → responde 502 pro QStash re-tentar. */
async function tratarFalha(
  admin: SupabaseClient, conexao: ConexaoCanal, orgId: string | null, e: unknown,
): Promise<Response> {
  const status = e instanceof MLApiError ? e.status : null;
  const oauthError = e instanceof MLApiError ? e.oauthError : null;
  const classe = classificarErroML(status, oauthError);
  if (classe === 'permanente-auth') {
    const { jaAlertado } = await registrarFalhaAuth(admin, conexao.id, (e as Error).message);
    if (!jaAlertado && orgId) {
      await notificarCategoria(admin, orgId, 'integracao', montarMensagemConexaoBloqueada(orgId, (e as Error).message));
    }
    return new Response(JSON.stringify({ ok: false, semCredencial: true }), { status: 200, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ ok: false, transiente: true }), { status: 502, headers: corsHeaders });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }
  let job: Job;
  try { job = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  const userId = job.user_id;
  if (!userId) return new Response('user_id obrigatório', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const orgId = await resolverOrgPorUserId(admin, userId);
  const conexao = orgId ? await resolverConexao(admin, orgId, 'mercado_livre') : null;
  if (!conexao) return new Response(JSON.stringify({ ok: false, semCredencial: true }), { status: 200, headers: corsHeaders });

  let token: string;
  try {
    token = await getValidAccessTokenConexao(conexao);
  } catch (e) {
    return await tratarFalha(admin, conexao, orgId, e);
  }

  // Resolve order_id: direto, ou via shipping_id (busca a venda já registrada com esse envio).
  let orderId = job.order_id ?? null;
  if (!orderId && job.shipping_id) {
    const { data } = await admin.from('ml_vendas')
      .select('order_id').eq('user_id', userId).eq('shipping_id', Number(job.shipping_id)).maybeSingle();
    orderId = data?.order_id != null ? String(data.order_id) : null;
  }
  if (!orderId) return new Response(JSON.stringify({ ok: true, ignorado: true }), { status: 200, headers: corsHeaders });

  let pedido;
  try {
    pedido = await buscarPedido(token, orderId);
  } catch (e) {
    if (e instanceof MLApiError && classificarErroML(e.status) === 'nao-encontrado') {
      return new Response(JSON.stringify({ ok: false, naoEncontrado: true }), { status: 200, headers: corsHeaders });
    }
    return await tratarFalha(admin, conexao, orgId, e);
  }

  const { idsPubliai, codigoResolver, eanResolver, infoPorGtin } = await carregarCatalogo(admin, userId);
  const shippingId = pedido.shipping?.id ?? null;
  const [frete, shipment, liquidoPorPayment, gtinPorItem] = await Promise.all([
    buscarFreteVendedor(token, shippingId),
    buscarShipment(token, shippingId),
    carregarLiquidoMP(admin, orgId),
    carregarGtinsFallback(token, [pedido], idsPubliai),
  ]);

  const { novaPaga, itens } = await upsertVenda(admin, userId, orgId, pedido, {
    freteVendedor: frete, shipment, idsPubliai, codigoResolver, eanResolver, infoPorGtin, gtinPorItem, liquidoPorPayment,
  });

  // Alerta de nova venda paga aos destinatários da categoria 'vendas'. Usa os itens já com EAN
  // resolvido (catálogo/GTIN). notificarCategoria respeita o interruptor-mestre da org.
  if (novaPaga && orgId) {
    await notificarCategoria(admin, orgId, 'vendas', montarMensagemNovaVenda({
      order_id: Number(pedido.id),
      comprador: pedido.buyer?.nickname ?? null,
      itens: itens.map((i) => ({ titulo: i.titulo, quantity: i.quantity, ean: i.ean })),
      total: Number(pedido.total_amount ?? 0),
      moeda: pedido.currency_id ?? 'BRL',
    }));

    // Mensagem automática ao comprador via ML (best-effort).
    if (conexao?.contaExternaId) {
      const packId = pedido.pack_id ?? pedido.id;
      await enviarMensagemPedido(
        token,
        packId,
        conexao.contaExternaId,
        'Olá! Recebemos seu pedido e já estamos separando. Em caso de dúvida, fique à vontade para chamar aqui pelo chat. Obrigado pela compra! 🙏',
      );
    }
  }

  // Marca o evento processado (best-effort).
  await admin.from('ml_webhook_eventos').update({ processado_em: new Date().toISOString() })
    .eq('topic', 'orders_v2').eq('resource', `/orders/${orderId}`);

  // Sucesso: registra liveness (reseta alerta de auth se a conexão tinha caído antes).
  await registrarSyncOk(admin, conexao.id);

  return new Response(JSON.stringify({ ok: true, novaPaga }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
