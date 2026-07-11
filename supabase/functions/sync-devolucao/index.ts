// Worker de sincronização de devolução/claim (ADR-0037). Consome QStash. Job: { user_id, claim_id }.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { buscarClaim, buscarReturn, upsertDevolucao } from '../_shared/faturamento/devolucoes-io.ts';
import { resolverOrgPorUserId } from '../_shared/faturamento/io.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { montarMensagemNovaDevolucao } from '../_shared/notificacoes/telegram.ts';

interface Job { user_id?: string; claim_id?: string }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  let job: Job;
  try { job = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!job.user_id || !job.claim_id) return new Response('user_id/claim_id obrigatórios', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const orgId = await resolverOrgPorUserId(admin, job.user_id);
  let token: string;
  try {
    const conexao = orgId ? await resolverConexao(admin, orgId, 'mercado_livre') : null;
    if (!conexao) throw new Error('sem conexão ML');
    token = await getValidAccessTokenConexao(conexao);
  }
  catch { return new Response(JSON.stringify({ ok: false, semCredencial: true }), { status: 200, headers: corsHeaders }); }

  const claim = await buscarClaim(token, job.claim_id);
  if (!claim) return new Response(JSON.stringify({ ok: false, naoEncontrado: true }), { status: 200, headers: corsHeaders });
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

  return new Response(JSON.stringify({ ok: true, nova }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
