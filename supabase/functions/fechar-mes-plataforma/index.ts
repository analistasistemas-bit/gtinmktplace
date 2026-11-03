// Fechamento automático do demonstrativo + aviso de fechamento mensal (ADR-0193 D-10/D-11).
// Só QStash (assinatura válida). Schedule `0 9 1 * *` (dia 01, 06:00 BRT) chega sem body → fecha o
// mês anterior em fan-out por org. Manual: { "month": "YYYY-MM", "dry_run": true } calcula e loga
// o resultado sem fechar, auditar nem enviar. Lógica em _shared/platform-admin/fechamento-automatico*.ts.
// Secrets: PLATFORM_SYSTEM_ACTOR_ID (super-admin ativo usado como ator do close), TELEGRAM_BOT_TOKEN
// (bot da plataforma — o mesmo do lead da landing), APP_URL (link da Central).
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { qstashClient, verificarAssinatura } from '../_shared/queue.ts';
import {
  AguardandoOrgs, EntradaInvalida, processarJobFechamento,
} from '../_shared/platform-admin/fechamento-automatico-io.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }
  let job: unknown;
  try { job = body.trim() ? JSON.parse(body) : {}; } catch { return json({ ok: false, erro: 'JSON inválido' }, 400); }

  const ator = Deno.env.get('PLATFORM_SYSTEM_ACTOR_ID') ?? '';
  if (!UUID.test(ator)) {
    console.error(JSON.stringify({ fn: 'fechar-mes-plataforma', erro: 'PLATFORM_SYSTEM_ACTOR_ID ausente ou inválido' }));
    return json({ ok: false, erro: 'PLATFORM_SYSTEM_ACTOR_ID ausente ou inválido' }, 500);
  }

  try {
    const resultado = await processarJobFechamento(adminClient(), job, {
      agora: new Date(),
      ator,
      tokenTelegram: Deno.env.get('TELEGRAM_BOT_TOKEN') ?? null,
      linkCentral: `${(Deno.env.get('APP_URL') ?? '').replace(/\/$/, '')}/#/admin`,
      url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/fechar-mes-plataforma`,
      retried: Number(req.headers.get('upstash-retried') ?? 0) || 0,
      publicar: (msgs) => qstashClient().batchJSON(msgs),
      novoId: () => crypto.randomUUID(),
    });
    return json({ ok: true, ...resultado });
  } catch (e) {
    if (e instanceof EntradaInvalida) return json({ ok: false, erro: e.message }, 400);
    const aguardando = e instanceof AguardandoOrgs;
    console[aguardando ? 'warn' : 'error'](JSON.stringify({ fn: 'fechar-mes-plataforma', job, erro: (e as Error).message }));
    return json({ ok: false, erro: (e as Error).message }, 500);
  }
});
