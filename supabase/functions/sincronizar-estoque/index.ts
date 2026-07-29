// E6b (ADR-0094): casca fina. Valida a assinatura do QStash e delega o miolo,
// que vive em processar.ts com dependências injetadas para ser testável.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { verificarAssinatura } from '../_shared/queue.ts';
import type { SincronizarEstoqueJob } from '../_shared/queue.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { processarSincronizacao, fabricarTokenPadrao } from './processar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: SincronizarEstoqueJob;
  try {
    job = JSON.parse(body);
  } catch {
    return new Response('Body inválido', { status: 400, headers: corsHeaders });
  }

  const r = await processarSincronizacao(
    { admin: adminClient(), resolverConexao, getConnector, fabricarToken: fabricarTokenPadrao },
    job,
  );
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
