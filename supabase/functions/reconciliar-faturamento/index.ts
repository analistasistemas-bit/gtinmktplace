// Reconciliação periódica (ADR-0037) — rede de segurança p/ webhooks perdidos.
// Disparada por QStash Schedule (ex.: 1h). Re-sincroniza a janela recente de pedidos
// (e perguntas/devoluções nas fases seguintes) de todos os usuários com credencial ML.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { mapearConexao } from '../_shared/canais/conexao.ts';
import { buscarPedidosPeriodo, carregarCatalogo, upsertVenda, buscarShipment, buscarFreteVendedor } from '../_shared/faturamento/io.ts';
import { carregarLiquidoMP, carregarGtinsFallback } from '../_shared/faturamento/enriquecimento.ts';
import { buscarPerguntasSeller, buscarTituloItem, upsertPergunta } from '../_shared/faturamento/perguntas-io.ts';
import { buscarClaimsSeller, buscarReturn, upsertDevolucao } from '../_shared/faturamento/devolucoes-io.ts';
import { classificarErroML, MLApiError } from '../_shared/ml/erro-ml.ts';
import { registrarFalhaAuth, registrarSyncOk } from '../_shared/ml/liveness.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { montarMensagemConexaoBloqueada } from '../_shared/notificacoes/telegram.ts';

const JANELA_HORAS = 72; // re-checa os últimos 3 dias (cobre atrasos/falhas de entrega).

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  const admin = adminClient();
  const ate = new Date();
  const desde = new Date(ate.getTime() - JANELA_HORAS * 60 * 60 * 1000);
  const intervalo = { desde: desde.toISOString(), ate: ate.toISOString() };

  // E7: itera as conexões (marketplace_connections), não mais ml_credentials.user_id.
  const { data: conexoes } = await admin.from('marketplace_connections')
    .select('id, org_id, canal, conta_externa_id, expires_at, criado_por').eq('canal', 'mercado_livre');
  let total = 0;
  for (const c of conexoes ?? []) {
    const orgId = c.org_id as string;
    const userId = (c.criado_por as string | null) ?? null; // proxy legado por user_id
    try {
      if (!userId) continue;
      const cx = { ...mapearConexao(c)!, criadoPor: userId };
      let token: string;
      try {
        token = await getValidAccessTokenConexao(cx);
      } catch (e) {
        const status = e instanceof MLApiError ? e.status : null;
        const oauthError = e instanceof MLApiError ? e.oauthError : null;
        if (classificarErroML(status, oauthError) === 'permanente-auth') {
          const { jaAlertado } = await registrarFalhaAuth(admin, cx.id, (e as Error).message);
          if (!jaAlertado) {
            await notificarCategoria(admin, orgId, 'integracao', montarMensagemConexaoBloqueada(orgId, (e as Error).message));
          }
        }
        continue;
      }
      let pedidos;
      try { pedidos = await buscarPedidosPeriodo(token, intervalo); } catch { continue; }
      const { idsPubliai, codigoResolver, eanResolver, infoPorGtin } = await carregarCatalogo(admin, userId);
      const [liquidoPorPayment, gtinPorItem] = await Promise.all([
        carregarLiquidoMP(admin, orgId),
        carregarGtinsFallback(token, pedidos, idsPubliai),
      ]);
      for (const pedido of pedidos) {
        try {
          const shippingId = pedido.shipping?.id ?? null;
          const [frete, shipment] = await Promise.all([
            buscarFreteVendedor(token, shippingId),
            buscarShipment(token, shippingId),
          ]);
          await upsertVenda(admin, userId, orgId, pedido, {
            freteVendedor: frete, shipment, idsPubliai, codigoResolver, eanResolver, infoPorGtin, gtinPorItem, liquidoPorPayment,
          });
          total++;
        } catch { /* segue */ }
      }

      // Perguntas (pega não respondidas perdidas por webhook).
      try {
        const perguntas = await buscarPerguntasSeller(token);
        const titulos = new Map<string, string | null>();
        for (const q of perguntas) {
          try {
            const itemId = q.item_id ?? null;
            if (itemId && !titulos.has(itemId)) titulos.set(itemId, await buscarTituloItem(token, itemId));
            await upsertPergunta(admin, userId, orgId, q, itemId ? titulos.get(itemId) ?? null : null);
          } catch { /* segue */ }
        }
      } catch { /* segue */ }

      // Devoluções/claims.
      try {
        const claims = await buscarClaimsSeller(token);
        for (const claim of claims) {
          try {
            const ret = await buscarReturn(token, String(claim.id));
            await upsertDevolucao(admin, userId, orgId, claim, ret);
          } catch { /* segue */ }
        }
      } catch { /* segue */ }

      // Token obtido com sucesso: registra liveness (reseta auth_alerta_em). Não depende de
      // pedidos/perguntas/claims individuais terem sucedido — esses catches continuam "segue".
      await registrarSyncOk(admin, cx.id);
    } catch (e) {
      console.error(`reconciliar-faturamento: falhou para org ${orgId}:`, e instanceof Error ? e.message : e);
    }
  }

  return new Response(JSON.stringify({ ok: true, reconciliados: total }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
