// Worker de sincronização de mensagens pós-venda (ADR-0067). Consome QStash.
// Job: { user_id, pack_id }. Busca o pack inteiro e faz upsert idempotente por message_id.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { resolverOrgPorUserId } from '../_shared/faturamento/io.ts';
import { buscarMensagensPack, upsertMensagens, resolverMetaPack } from '../_shared/faturamento/mensagens-io.ts';
import { mapearMensagem } from '../_shared/faturamento/mensagem-mapper.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { montarMensagemNovaMensagem } from '../_shared/notificacoes/telegram.ts';

interface Job { user_id?: string; pack_id?: string }

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  let job: Job;
  try { job = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!job.user_id || !job.pack_id) return new Response('user_id/pack_id obrigatórios', { status: 400, headers: corsHeaders });

  const admin = adminClient();
  const orgId = await resolverOrgPorUserId(admin, job.user_id);
  let token: string;
  let sellerId: string;
  try {
    const conexao = orgId ? await resolverConexao(admin, orgId, 'mercado_livre') : null;
    if (!conexao || !conexao.contaExternaId) throw new Error('sem conexão ML');
    sellerId = conexao.contaExternaId;
    token = await getValidAccessTokenConexao(conexao);
  } catch { return new Response(JSON.stringify({ ok: false, semCredencial: true }), { status: 200, headers: corsHeaders }); }

  // Metadados do pedido (order_id + título) para exibir junto da conversa. Best-effort.
  const { orderId, itemTitulo } = await resolverMetaPack(admin, job.user_id, job.pack_id);

  const msgs = await buscarMensagensPack(token, job.pack_id, sellerId);
  const { novasRecebidas } = await upsertMensagens(admin, job.user_id, orgId, job.pack_id, orderId, itemTitulo, sellerId, msgs);

  if (novasRecebidas > 0 && orgId) {
    // Última mensagem recebida (mais recente) para o alerta.
    const recebidas = msgs.map((m) => mapearMensagem(m, sellerId)).filter((r) => r.direcao === 'recebida');
    const ultima = recebidas[recebidas.length - 1];
    if (ultima) {
      await notificarCategoria(admin, orgId, 'mensagens', montarMensagemNovaMensagem({ texto: ultima.texto, item_titulo: itemTitulo }));
    }
  }

  // Reabre o dedup da conversa: para `messages` a linha em ml_webhook_eventos BLOQUEIA o próximo
  // evento do mesmo pack (resource idêntico p/ toda mensagem da conversa) — remover em vez de
  // marcar processado permite que a próxima mensagem volte a inserir e enfileirar (Step 3, plan 035).
  await admin.from('ml_webhook_eventos').delete()
    .eq('topic', 'messages').eq('user_id', job.user_id)
    .like('resource', `%/packs/${job.pack_id}/%`);

  return new Response(JSON.stringify({ ok: true, novasRecebidas }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
