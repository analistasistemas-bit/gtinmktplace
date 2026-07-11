// Worker de sincronização de pergunta (ADR-0037). Consome QStash. Job: { user_id, question_id }.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { buscarPergunta, buscarTituloItem, upsertPergunta } from '../_shared/faturamento/perguntas-io.ts';
import { resolverOrgPorUserId } from '../_shared/faturamento/io.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { montarMensagemNovaPergunta } from '../_shared/notificacoes/telegram.ts';

interface Job { user_id?: string; question_id?: string }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  let job: Job;
  try { job = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!job.user_id || !job.question_id) return new Response('user_id/question_id obrigatórios', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const orgId = await resolverOrgPorUserId(admin, job.user_id);
  let token: string;
  try {
    const conexao = orgId ? await resolverConexao(admin, orgId, 'mercado_livre') : null;
    if (!conexao) throw new Error('sem conexão ML');
    token = await getValidAccessTokenConexao(conexao);
  }
  catch { return new Response(JSON.stringify({ ok: false, semCredencial: true }), { status: 200, headers: corsHeaders }); }

  const pergunta = await buscarPergunta(token, job.question_id);
  if (!pergunta) return new Response(JSON.stringify({ ok: false, naoEncontrada: true }), { status: 200, headers: corsHeaders });

  const titulo = await buscarTituloItem(token, pergunta.item_id ?? null);
  const { novaNaoRespondida, row } = await upsertPergunta(admin, job.user_id, orgId, pergunta, titulo);

  if (novaNaoRespondida && orgId) {
    await notificarCategoria(admin, orgId, 'perguntas', montarMensagemNovaPergunta({
      question_id: row.question_id, texto: row.texto, item_titulo: titulo,
    }));
  }
  await admin.from('ml_webhook_eventos').update({ processado_em: new Date().toISOString() })
    .eq('topic', 'questions').eq('resource', `/questions/${job.question_id}`);

  return new Response(JSON.stringify({ ok: true, novaNaoRespondida }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
