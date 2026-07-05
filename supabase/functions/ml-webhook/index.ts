// Receiver de webhooks do ML (ADR-0037). Público (verify_jwt=false) — o ML chama sem auth.
// ACK 200 sempre e <500ms: faz o mínimo (parse, resolve user, dedup, enfileira) e devolve.
// NUNCA confia no corpo: o dado só entra após fetch autenticado feito pelo worker.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { qstashClient } from '../_shared/queue.ts';
import { parseWebhookNotification } from '../_shared/faturamento/venda.ts';
import { resolverIdentidade } from '../_shared/faturamento/io.ts';

// topic → função worker + nome do campo do id no job.
const ROTA: Record<string, { fn: string; campo: string }> = {
  orders_v2: { fn: 'sync-venda', campo: 'order_id' },
  shipments: { fn: 'sync-venda', campo: 'shipping_id' },
  questions: { fn: 'sync-pergunta', campo: 'question_id' },
  claims: { fn: 'sync-devolucao', campo: 'claim_id' },
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

  // Dedup: 1 evento por (topic, resource). Conflito → já recebido, não reenfileira.
  const { error: dupErr } = await admin.from('ml_webhook_eventos')
    .insert({ user_id: userId, org_id: orgId, topic: ev.topic, resource: ev.resource });
  if (dupErr) return ok(); // unique violation (duplicado) ou outro: ack mesmo assim.

  try {
    const target = `${Deno.env.get('SUPABASE_URL')}/functions/v1/${rota.fn}`;
    await qstashClient().publishJSON({
      url: target,
      body: { user_id: userId, [rota.campo]: ev.resourceId },
      retries: 3,
    });
  } catch (e) {
    // Falha ao enfileirar: registra o erro mas ACK (a reconciliação recupera depois).
    await admin.from('ml_webhook_eventos').update({ erro: String(e) })
      .eq('topic', ev.topic).eq('resource', ev.resource);
  }
  return ok();
});
