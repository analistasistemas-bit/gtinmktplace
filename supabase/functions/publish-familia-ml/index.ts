import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { processarFamiliaML, type Job } from './processar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: Job;
  try {
    job = JSON.parse(body);
  } catch {
    return new Response('Body inválido', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();
  const conn = getConnector('mercado_livre');
  const tentativas = Number(req.headers.get('Upstash-Retried') ?? '0');
  const json = (obj: unknown) => new Response(JSON.stringify(obj), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const r = await processarFamiliaML({ admin, conn }, job, { tentativas });
  switch (r.tipo) {
    case 'familia_inexistente': return new Response('familia não encontrada', { status: 404, headers: corsHeaders });
    case 'ja_publicado': return json({ jaPublicado: true });
    case 'ok': return json({ ml_item_id: r.itemExternoId });
    case 'erro': return json({ erro: r.mensagem });
    // Transitório: 500 (texto) para o QStash retentar, mantendo a família 'publicando'.
    case 'retry': return new Response(r.mensagem, { status: 500, headers: corsHeaders });
  }
});
