import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';

interface Job { familia_id: string; lote_id: string; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const body = await req.text();
  // TODO(M3): restaurar verificação de assinatura QStash quando chaves estiverem
  // confirmadas corretas no Supabase Vault. Bypassado para bug bash M2.
  // const ok = await verificarAssinatura(req, body);
  // if (!ok) return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  void verificarAssinatura; // evita "unused import"

  let job: Job;
  try {
    job = JSON.parse(body);
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
  }
  if (!job.familia_id || !job.lote_id) {
    return new Response('familia_id e lote_id obrigatórios', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();

  // Idempotência (ADR-0006): UPDATE atômico pendente → processando
  const { data: claimed, error: claimErr } = await admin
    .from('familias')
    .update({ status: 'processando' })
    .eq('id', job.familia_id)
    .eq('status', 'pendente')
    .select('id')
    .maybeSingle();
  if (claimErr) {
    return new Response(`Erro no claim: ${claimErr.message}`, { status: 500, headers: corsHeaders });
  }
  if (!claimed) {
    return new Response('Already processed', { status: 200, headers: corsHeaders });
  }

  try {
    // === STUB DO M2 ===
    // Real logic (IA, concorrência) entra em M3/M4. Por ora, só marca 'pronto'.
    await admin
      .from('familias')
      .update({ status: 'pronto' })
      .eq('id', job.familia_id);
    // ==================

    return new Response('OK', { status: 200, headers: corsHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await admin
      .from('familias')
      .update({ status: 'erro', erro_mensagem: msg })
      .eq('id', job.familia_id);
    return new Response(`Erro: ${msg}`, { status: 500, headers: corsHeaders });
  }
});
