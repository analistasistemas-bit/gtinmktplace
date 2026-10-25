// Resumo diário (ADR-0190 D-6). Consome QStash (assinatura válida): o schedule `0 11 * * *` (08:00 BRT)
// chega sem body/sem `orgId` → publica um job por org com o dia anterior; { orgId, dia } → monta e
// notifica `resumo_diario`. Erro → 500 para o QStash tentar de novo (a chave por dia evita duplicata).
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { processarJobResumo, type JobResumo } from '../_shared/notificacoes/gerencial/resumo-io.ts';

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }
  let job: JobResumo;
  try { job = body.trim() ? JSON.parse(body) : {}; } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (job.orgId && !/^\d{4}-\d{2}-\d{2}$/.test(job.dia ?? '')) {
    return new Response('dia obrigatório (YYYY-MM-DD)', { status: 400, headers: corsHeaders });
  }

  try {
    return json({ ok: true, ...(await processarJobResumo(adminClient(), job, new Date())) });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'resumo-diario', orgId: job.orgId, dia: job.dia, erro: (e as Error).message }));
    return json({ ok: false, erro: (e as Error).message }, 500);
  }
});
