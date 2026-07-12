// Worker de sincronização de devolução/claim (ADR-0037). Consome QStash. Job: { user_id, claim_id }.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import { buscarClaim, buscarReturn, upsertDevolucao } from '../_shared/faturamento/devolucoes-io.ts';
import { resolverOrgPorUserId } from '../_shared/faturamento/io.ts';
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
  const classe = classificarErroML(status);
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
  await admin.from('ml_webhook_eventos').update({ processado_em: new Date().toISOString() })
    .eq('topic', 'claims').eq('resource', `/claims/${job.claim_id}`);

  // Sucesso: registra liveness (reseta alerta de auth se a conexão tinha caído antes).
  await registrarSyncOk(admin, conexao.id);

  return new Response(JSON.stringify({ ok: true, nova }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
