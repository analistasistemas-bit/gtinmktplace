// Worker de sincronização de pergunta (ADR-0037). Consome QStash. Job: { user_id, question_id }.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao, type ConexaoCanal } from '../_shared/canais/conexao.ts';
import { buscarPergunta, buscarTituloItem, upsertPergunta } from '../_shared/faturamento/perguntas-io.ts';
import { reservarNotificacao } from '../_shared/faturamento/notificacoes-dedupe.ts';
import { resolverOrgPorUserId } from '../_shared/faturamento/io.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { montarMensagemNovaPergunta, montarMensagemConexaoBloqueada } from '../_shared/notificacoes/telegram.ts';
import { classificarErroML, MLApiError } from '../_shared/ml/erro-ml.ts';
import { registrarFalhaAuth, registrarSyncOk } from '../_shared/ml/liveness.ts';
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

interface Job { user_id?: string; question_id?: string }

/** Mesmo padrão de sync-venda: classifica o erro (token ou fetch do recurso) e trata conforme a
 * liveness (ADR-0069). permanente-auth → registra + alerta (só na 1ª falha), responde 200;
 * transiente → 502 pro QStash re-tentar. */
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
  if (!job.user_id || !job.question_id) return new Response('user_id/question_id obrigatórios', { status: 400, headers: corsHeaders });

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

  let pergunta;
  try {
    pergunta = await buscarPergunta(token, job.question_id);
  } catch (e) {
    if (e instanceof MLApiError && classificarErroML(e.status) === 'nao-encontrado') {
      return new Response(JSON.stringify({ ok: false, naoEncontrada: true }), { status: 200, headers: corsHeaders });
    }
    return await tratarFalha(admin, conexao, orgId, e);
  }

  const titulo = await buscarTituloItem(token, pergunta.item_id ?? null);
  const { novaNaoRespondida, row } = await upsertPergunta(admin, job.user_id, orgId, pergunta, titulo);

  if (novaNaoRespondida && orgId && await reservarNotificacao(admin, orgId, job.user_id, 'pergunta_nova', String(row.question_id))) {
    await notificarCategoria(admin, orgId, 'perguntas', montarMensagemNovaPergunta({
      question_id: row.question_id, texto: row.texto, item_titulo: titulo,
    }));
  }
  await admin.from('ml_webhook_eventos').update({ processado_em: new Date().toISOString() })
    .eq('topic', 'questions').eq('resource', `/questions/${job.question_id}`);

  // Sucesso: registra liveness (reseta alerta de auth se a conexão tinha caído antes).
  await registrarSyncOk(admin, conexao.id);

  return new Response(JSON.stringify({ ok: true, novaNaoRespondida }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
