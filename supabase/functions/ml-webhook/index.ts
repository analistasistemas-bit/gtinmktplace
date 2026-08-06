// Receiver de webhooks do ML (ADR-0037). Público (verify_jwt=false) — o ML chama sem auth.
// ACK 200 sempre e <500ms: faz o mínimo (parse, resolve user, dedup, enfileira) e devolve.
// NUNCA confia no corpo: o dado só entra após fetch autenticado feito pelo worker.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { qstashClient } from '../_shared/queue.ts';
import { parseWebhookNotification, extrairPackIdDeMensagem } from '../_shared/faturamento/venda.ts';
import { resolverIdentidade } from '../_shared/faturamento/io.ts';
import { deveThrottlar, JANELA_THROTTLE_MS } from '../_shared/ml/throttle-webhook.ts';
import { redisIncrComTTL } from '../_shared/redis/client.ts';
import { deveReenfileirarMensagens, classificarDedupWebhook } from '../_shared/ml/reenfileirar-mensagens.ts';

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
  // (Redis fora do ar etc.) NUNCA bloqueia o vendedor legítimo: cai no comportamento de hoje.
  //
  // O contador vive no Redis, não em `ml_webhook_eventos` (F10): contando linhas, um resource
  // que fizesse o INSERT falhar com erro != 23505 caía no fail-open logo abaixo e enfileirava
  // SEM gravar linha — ou seja, tráfego forjado que o contador nunca enxergava. Contando aqui,
  // toda requisição que chega a um vendedor conhecido conta, tenha o INSERT dado certo ou não.
  // Janela fixa de 60s (o TTL nasce no 1º evento), no lugar da janela deslizante da query.
  try {
    const janelaSeg = Math.floor(JANELA_THROTTLE_MS / 1000);
    // A janela entra NA CHAVE, não só no TTL. Se o EXPIRE falhar depois do INCR, a chave fica
    // sem TTL — com chave fixa ela seria imortal e, passando de 200, calaria os webhooks desse
    // vendedor para sempre (ACK 200, sem log, e perguntas/devoluções não têm backstop). Com a
    // janela na chave, o pior caso é vazar uma chave: a janela seguinte usa outra de qualquer jeito.
    const janela = Math.floor(Date.now() / JANELA_THROTTLE_MS);
    const recentes = await redisIncrComTTL(`throttle:ml-webhook:${userId}:${janela}`, janelaSeg);
    // Acima do limite: dropa (ACK, sem insert/enqueue). `orders_v2`/`shipments` voltam pelo
    // job horário reconciliar-faturamento; `questions`, `claims` e `messages` NÃO têm backstop
    // (ver comentário abaixo e reenfileirar-mensagens.ts) — para esses, o evento se perde.
    if (deveThrottlar(recentes)) {
      console.warn(`ml-webhook: throttle ativo p/ user ${userId} (${recentes} eventos na janela), evento ${ev.topic} descartado`);
      return ok();
    }
  } catch (e) {
    // fail-open: segue o fluxo normal abaixo. Loga porque um Redis fora do ar (ou UPSTASH_*
    // ausente) transforma o throttle num no-op permanente e silencioso.
    console.warn('ml-webhook: throttle indisponível, seguindo sem limite:', e instanceof Error ? e.message : String(e));
  }

  // Dedup: 1 evento por (topic, resource). Conflito → já recebido, não reenfileira — exceto
  // `messages` (Step 4, plan 035): o resource é o mesmo para toda a conversa, então a linha de
  // dedup fica "viva" enquanto o worker não processa. Se ela for antiga e nunca processada, é
  // sinal de job perdido: reenfileira mesmo com o conflito (a linha de dedup permanece intacta).
  const { error: dupErr } = await admin.from('ml_webhook_eventos')
    .insert({ user_id: userId, org_id: orgId, topic: ev.topic, resource: ev.resource });
  const acaoDedup = classificarDedupWebhook(dupErr, ev.topic);
  if (acaoDedup === 'ignorar') return ok(); // duplicado real (23505) de topic ≠ messages.
  if (acaoDedup === 'checar-messages') {
    const { data: existente } = await admin.from('ml_webhook_eventos')
      .select('recebido_em, processado_em').eq('topic', 'messages').eq('resource', ev.resource)
      .eq('user_id', userId).maybeSingle();
    if (!deveReenfileirarMensagens(existente, Date.now())) return ok();
  } else if (dupErr && (dupErr as { code?: string }).code !== '23505') {
    // 'enfileirar' com erro não-23505 (RLS/timeout/pool): NÃO engole o evento (perguntas/devoluções
    // não têm backstop). Loga e segue p/ enfileirar — o worker é idempotente.
    console.error('ml-webhook: erro não-duplicado ao inserir dedup, prossegue p/ enfileirar:', (dupErr as { message?: string }).message ?? (dupErr as { code?: string }).code);
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
