// Worker da notificação gerencial por carrinho (ADR-0190 D-2/D-4). Consome QStash (assinatura válida).
// Job: { orgId, chave } → processarCarrinho (aguarda/envia/descarta); { varrer: true, depois? } →
// varrerCarrinhos (só republica jobs de linhas paradas). Erro de leitura antes do claim → 500 para o
// QStash tentar de novo; a linha continua `aguardando`.
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { processarCarrinho, varrerCarrinhos } from '../_shared/notificacoes/gerencial/carrinho-io.ts';

interface Job { orgId?: string; chave?: string; varrer?: boolean; depois?: { orgId: string; chave: string } }

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }
  let job: Job;
  try { job = JSON.parse(body); } catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }

  const admin = adminClient();
  try {
    if (job.varrer) return json({ ok: true, publicados: await varrerCarrinhos(admin, new Date(), job.depois) });
    if (!job.orgId || !job.chave) return new Response('orgId e chave obrigatórios', { status: 400, headers: corsHeaders });
    return json({ ok: true, resultado: await processarCarrinho(admin, job.orgId, job.chave, new Date()) });
  } catch (e) {
    console.error(JSON.stringify({ fn: 'notificar-carrinho', orgId: job.orgId, chave: job.chave, erro: (e as Error).message }));
    return json({ ok: false, erro: (e as Error).message }, 500);
  }
});
