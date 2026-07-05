// Worker de sincronização de venda (ADR-0037). Consome QStash (assinatura válida).
// Job: { user_id, order_id } (orders_v2) ou { user_id, shipping_id } (shipments).
// Faz fetch autenticado do pedido (+ shipment/frete), upsert e alerta Telegram em venda nova.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import {
  buscarPedido, buscarFreteVendedor, buscarShipment, carregarCatalogo, upsertVenda, resolverOrgPorUserId,
} from '../_shared/faturamento/io.ts';
import { carregarLiquidoMP, carregarGtinsFallback } from '../_shared/faturamento/enriquecimento.ts';
import { lerConfigTelegram } from '../_shared/notificacoes/config.ts';
import { enviarTelegram, montarMensagemNovaVenda } from '../_shared/notificacoes/telegram.ts';
import { enviarMensagemPedido } from '../_shared/ml/mensagem.ts';

interface Job { user_id?: string; order_id?: string; shipping_id?: string }

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
  let token: string;
  try { token = await getValidAccessToken(userId); }
  catch { return new Response(JSON.stringify({ ok: false, semCredencial: true }), { status: 200, headers: corsHeaders }); }

  // Resolve order_id: direto, ou via shipping_id (busca a venda já registrada com esse envio).
  let orderId = job.order_id ?? null;
  if (!orderId && job.shipping_id) {
    const { data } = await admin.from('ml_vendas')
      .select('order_id').eq('user_id', userId).eq('shipping_id', Number(job.shipping_id)).maybeSingle();
    orderId = data?.order_id != null ? String(data.order_id) : null;
  }
  if (!orderId) return new Response(JSON.stringify({ ok: true, ignorado: true }), { status: 200, headers: corsHeaders });

  const pedido = await buscarPedido(token, orderId);
  if (!pedido) return new Response(JSON.stringify({ ok: false, naoEncontrado: true }), { status: 200, headers: corsHeaders });

  const orgId = await resolverOrgPorUserId(admin, userId);
  const { idsPubliai, codigoResolver, eanResolver, infoPorGtin } = await carregarCatalogo(admin, userId);
  const shippingId = pedido.shipping?.id ?? null;
  const [frete, shipment, liquidoPorPayment, gtinPorItem] = await Promise.all([
    buscarFreteVendedor(token, shippingId),
    buscarShipment(token, shippingId),
    carregarLiquidoMP(),
    carregarGtinsFallback(token, [pedido], idsPubliai),
  ]);

  const { novaPaga, itens } = await upsertVenda(admin, userId, orgId, pedido, {
    freteVendedor: frete, shipment, idsPubliai, codigoResolver, eanResolver, infoPorGtin, gtinPorItem, liquidoPorPayment,
  });

  // Alerta de nova venda paga (só se Telegram ativo). Usa os itens já com EAN resolvido (catálogo/GTIN).
  if (novaPaga) {
    const cfg = await lerConfigTelegram(admin, userId);
    if (cfg.ativo) {
      await enviarTelegram(cfg.token, cfg.chatId, montarMensagemNovaVenda({
        order_id: Number(pedido.id),
        comprador: pedido.buyer?.nickname ?? null,
        itens: itens.map((i) => ({ titulo: i.titulo, quantity: i.quantity, ean: i.ean })),
        total: Number(pedido.total_amount ?? 0),
        moeda: pedido.currency_id ?? 'BRL',
      }));
    }

    // Mensagem automática ao comprador via ML (best-effort).
    const { data: cred } = await admin.from('ml_credentials')
      .select('ml_user_id').eq('user_id', userId).maybeSingle();
    if (cred?.ml_user_id) {
      const packId = pedido.pack_id ?? pedido.id;
      await enviarMensagemPedido(
        token,
        packId,
        cred.ml_user_id,
        'Olá! Recebemos seu pedido e já estamos separando. Em caso de dúvida, fique à vontade para chamar aqui pelo chat. Obrigado pela compra! 🙏',
      );
    }
  }

  // Marca o evento processado (best-effort).
  await admin.from('ml_webhook_eventos').update({ processado_em: new Date().toISOString() })
    .eq('topic', 'orders_v2').eq('resource', `/orders/${orderId}`);

  return new Response(JSON.stringify({ ok: true, novaPaga }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
