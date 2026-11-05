// ADR-0195: casca fina. Valida a assinatura do QStash e delega o miolo, que vive em processar.ts
// com dependências injetadas para ser testável.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { enfileirarConfirmacao, verificarAssinatura } from '../_shared/queue.ts';
import type { ConfirmarJob } from '../_shared/queue.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { lerEstoqueItens } from '../_shared/ml/ler-estoque-itens.ts';
import { notificarCategoria } from '../_shared/notificacoes/config.ts';
import { processarConfirmacao } from './processar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  const body = await req.text();
  if (!(await verificarAssinatura(req, body))) {
    return new Response('Invalid signature', { status: 401, headers: corsHeaders });
  }

  let job: ConfirmarJob;
  try {
    job = JSON.parse(body);
  } catch {
    return new Response('Body inválido', { status: 400, headers: corsHeaders });
  }

  const r = await processarConfirmacao({
    admin: adminClient(),
    resolverConexao,
    getToken: getValidAccessTokenConexao,
    lerEstoqueItens,
    enfileirarConfirmacao,
    notificarCategoria,
    agora: () => new Date().toISOString(),
  }, job);
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
