import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao) return new Response('OK', { status: 200, headers: corsHeaders }); // idempotente: já desconectado

  const { error } = await admin.rpc('delete_marketplace_connection', { p_connection_id: conexao.id });
  if (error) {
    console.error('delete_marketplace_connection:', error.message);
    return new Response('Erro ao desconectar conta ML', { status: 500, headers: corsHeaders });
  }
  return new Response('OK', { status: 200, headers: corsHeaders });
});
