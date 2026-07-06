import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import type { PublicarAnuncioJob } from '../_shared/queue.ts';
import { processarJob } from './processar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: PublicarAnuncioJob;
  try {
    job = JSON.parse(body);
  } catch {
    return new Response('Body inválido', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();
  const resultado = await processarJob({ admin }, job);

  if (resultado.tipo === 'erro_retentavel') {
    // Transitório (5xx/429/rede): mantém a linha 'publicando' e relança para o QStash retentar.
    return new Response(resultado.mensagem, { status: 500, headers: corsHeaders });
  }
  return new Response(JSON.stringify(resultado), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
