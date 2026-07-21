// Worker de sincronização de devolução/claim (ADR-0037). Consome QStash. Job: { user_id, claim_id }.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import { buscarClaim, buscarReturn, upsertDevolucao } from '../_shared/faturamento/devolucoes-io.ts';
import {
  buscarPedido, buscarFreteVendedor, buscarShipment, carregarCatalogo, upsertVenda, resolverOrgPorUserId,
} from '../_shared/faturamento/io.ts';
import { carregarLiquidoMP, carregarGtinsFallback } from '../_shared/faturamento/enriquecimento.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { montarMensagemNovaDevolucao, montarMensagemConexaoBloqueada } from '../_shared/notificacoes/telegram.ts';
import { classificarErroML, MLApiError } from '../_shared/ml/erro-ml.ts';
import { registrarFalhaAuth, registrarSyncOk } from '../_shared/ml/liveness.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

interface Job { user_id?: string; claim_id?: string }

/** Mesmo padrão de sync-venda/sync-pergunta (ADR-0069). */
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
  if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  let job: Job;
  try { job = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!job.user_id || !job.claim_id) return new Response('user_id/claim_id obrigatórios', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const orgId = await resolverOrgPorUserId(admin, job.user_id);
  const conexao = orgId ? await resolverConexao(admin, orgId, 'mercado_livre') : null;
  if (!conexao) return new Response(JSON.stringify({ ok: false, semCredencial: true }), { status: 200, headers: corsHeaders });

  let token: string;
  try {
    token = await getValidAccessTokenConexao(conexao);
  } catch (e) {
    return await tratarFalha(admin, conexao, orgId, e);
  }

  let claim;
  try {
    claim = await buscarClaim(token, job.claim_id);
  } catch (e) {
    if (e instanceof MLApiError && classificarErroML(e.status) === 'nao-encontrado') {
      return new Response(JSON.stringify({ ok: false, naoEncontrado: true }), { status: 200, headers: corsHeaders });
    }
    return await tratarFalha(admin, conexao, orgId, e);
  }
  // buscarReturn continua devolvendo null em erro/ausência (não convertido para MLApiError —
  // "sem return ainda" é estado de negócio válido, não indica token morto).
  const ret = await buscarReturn(token, job.claim_id);

  const { nova, row } = await upsertDevolucao(admin, job.user_id, orgId, claim, ret);

  if (nova && orgId) {
    await notificarCategoria(admin, orgId, 'pos_venda', montarMensagemNovaDevolucao({
      claim_id: row.claim_id, order_id: row.order_id, tipo: row.type ?? 'claim',
      motivo: row.reason_texto, valor: row.valor_em_jogo, moeda: 'BRL',
    }));
  }

  // Recalcula liquido/estorno da venda ligada ao claim (mesmo pipeline de sync-venda) — sem isso
  // ml_vendas.liquido/estorno só se atualizam se orders_v2/shipments disparar de novo, e devolução
  // costuma chegar dias/semanas depois da venda (fora da janela de reconciliar-faturamento).
  // upsertVenda é idempotente: pedido já pago não gera novaPaga=true de novo, então não reenvia
  // alerta/mensagem de nova venda. Falha aqui usa o mesmo retry via QStash de buscarClaim acima —
  // o claim já está gravado (upsertDevolucao), então um retry não duplica nada.
  if (row.order_id != null) {
    try {
      const pedido = await buscarPedido(token, String(row.order_id));
      const { idsPubliai, codigoResolver, eanResolver, infoPorGtin } = await carregarCatalogo(admin, job.user_id);
      const shippingId = pedido.shipping?.id ?? null;
      const [frete, shipment, liquidoPorPayment, gtinPorItem] = await Promise.all([
        buscarFreteVendedor(token, shippingId),
        buscarShipment(token, shippingId),
        carregarLiquidoMP(admin, orgId),
        carregarGtinsFallback(token, [pedido], idsPubliai),
      ]);
      await upsertVenda(admin, job.user_id, orgId, pedido, {
        freteVendedor: frete, shipment, idsPubliai, codigoResolver, eanResolver, infoPorGtin, gtinPorItem, liquidoPorPayment,
      });
    } catch (e) {
      if (e instanceof MLApiError && classificarErroML(e.status) === 'nao-encontrado') {
        // Pedido sumiu do ML: nada a recalcular, o claim já está gravado.
      } else {
        return await tratarFalha(admin, conexao, orgId, e);
      }
    }
  }

  await admin.from('ml_webhook_eventos').update({ processado_em: new Date().toISOString() })
    .eq('topic', 'claims').eq('resource', `/claims/${job.claim_id}`);

  // Sucesso: registra liveness (reseta alerta de auth se a conexão tinha caído antes).
  await registrarSyncOk(admin, conexao.id);

  return new Response(JSON.stringify({ ok: true, nova }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
