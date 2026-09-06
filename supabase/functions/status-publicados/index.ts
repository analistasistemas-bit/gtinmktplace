import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import { lerPrecoKitML, lerEstoqueKitML } from '../_shared/ml/kit-virtual.ts';
import { montarStatusPublicados } from './processar.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  // Gate de auth: só membro autenticado da operação (o token ML usado é o da própria org).
  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  const resultado = await montarStatusPublicados({
    admin,
    resolverConexao,
    getConnector,
    getValidAccessTokenConexao,
    lerPrecoKit: lerPrecoKitML,
    lerEstoqueKit: lerEstoqueKitML,
  }, orgId);

  return new Response(JSON.stringify(resultado), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
