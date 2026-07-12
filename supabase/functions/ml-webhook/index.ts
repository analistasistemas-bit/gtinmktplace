// Receiver de webhooks do ML (ADR-0037). Público (verify_jwt=false) — o ML chama sem auth.
// ACK 200 sempre e <500ms: faz o mínimo (parse, resolve user, dedup, enfileira) e devolve.
// NUNCA confia no corpo: o dado só entra após fetch autenticado feito pelo worker.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { qstashClient } from '../_shared/queue.ts';
import { parseWebhookNotification, extrairPackIdDeMensagem } from '../_shared/faturamento/venda.ts';
import { resolverIdentidade } from '../_shared/faturamento/io.ts';
import { deveThrottlar, JANELA_THROTTLE_MS } from '../_shared/ml/throttle-webhook.ts';
import { deveReenfileirarMensagens } from '../_shared/ml/reenfileirar-mensagens.ts';

// topic → função worker + nome do campo do id no job.
const ROTA: Record<string, { fn: string; campo: string }> = {
  orders_v2: { fn: 'sync-venda', campo: 'order_id' },
  shipments: { fn: 'sync-venda', campo: 'shipping_id' },
  questions: { fn: 'sync-pergunta', campo: 'question_id' },
  claims: { fn: 'sync-devolucao', campo: 'claim_id' },
  messages: { fn: 'sync-mensagem', campo: 'pack_id' },
};

const ok = () => new Response(JSON.stringify({ ok: true }), {
  status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let raw: unknown;
  try { raw = await req.json(); } catch { return ok(); } // corpo inválido: ack e ignora.

  const ev = parseWebhookNotification(raw);
  if (!ev) return ok();
  const rota = ROTA[ev.topic];
  if (!rota) return ok(); // tópico não tratado: ack e ignora.

  const admin = adminClient();
  const identidade = await resolverIdentidade(admin, ev.mlUserId);
  if (!identidade) return ok(); // vendedor desconhecido: ack e ignora.
  const { userId, orgId } = identidade;

  // Throttle (INT-018/033): protege contra atacante que conhece o mlUserId público de um
  // vendedor e forja notificações para inflar a tabela + gasto de QStash. Falha na contagem
  // (query dá erro etc.) NUNCA bloqueia o vendedor legítimo: cai no comportamento de hoje.
  try {
    const desde = new Date(Date.now() - JANELA_THROTTLE_MS).toISOString();
    const { count, error: countErr } = await admin.from('ml_webhook_eventos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('recebido_em', desde);
    if (!countErr && deveThrottlar(count ?? 0)) return ok(); // acima do limite: dropa (ACK, sem insert/enqueue); reconciliar-faturamento recupera.
  } catch { /* fail-open: segue o fluxo normal abaixo. */ }

  // Dedup: 1 evento por (topic, resource). Conflito → já recebido, não reenfileira — exceto
  // `messages` (Step 4, plan 035): o resource é o mesmo para toda a conversa, então a linha de
  // dedup fica "viva" enquanto o worker não processa. Se ela for antiga e nunca processada, é
  // sinal de job perdido: reenfileira mesmo com o conflito (a linha de dedup permanece intacta).
  const { error: dupErr } = await admin.from('ml_webhook_eventos')
    .insert({ user_id: userId, org_id: orgId, topic: ev.topic, resource: ev.resource });
  if (dupErr) {
    if (ev.topic !== 'messages') return ok();
    const { data: existente } = await admin.from('ml_webhook_eventos')
      .select('recebido_em, processado_em').eq('topic', 'messages').eq('resource', ev.resource)
      .eq('user_id', userId).maybeSingle();
    if (!deveReenfileirarMensagens(existente, Date.now())) return ok();
  }

  // `messages`: o id do job é o pack, não o último segmento do resource (que é o seller).
  const idJob = ev.topic === 'messages' ? extrairPackIdDeMensagem(ev.resource) : ev.resourceId;
  if (!idJob) return ok(); // resource sem pack: ack e ignora.

  try {
    const target = `${Deno.env.get('SUPABASE_URL')}/functions/v1/${rota.fn}`;
    await qstashClient().publishJSON({
      url: target,
      body: { user_id: userId, [rota.campo]: idJob },
      retries: 3,
    });
  } catch (e) {
    // Falha ao enfileirar: registra o erro mas ACK (a reconciliação recupera depois).
    await admin.from('ml_webhook_eventos').update({ erro: String(e) })
      .eq('topic', ev.topic).eq('resource', ev.resource);
  }
  return ok();
});
