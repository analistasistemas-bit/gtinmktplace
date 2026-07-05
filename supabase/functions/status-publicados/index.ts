import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { getValidAccessTokenConexao } from '../_shared/ml/token.ts';
import { resolverConexao } from '../_shared/canais/conexao.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import type { StatusCanal } from '../_shared/canais/contrato.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  // Gate de auth: só membro autenticado da operação (o token ML usado é o da própria org).
  let orgId: string;
  try { ({ orgId } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  // Escopo da organização (E7): a lista de anúncios é compartilhada dentro da org
  // (RLS org_id, D-E7.3), então o status ao vivo cobre os anúncios de toda a org.
  const { data: familias } = await admin.from('familias')
    .select('ml_item_id').eq('org_id', orgId).not('ml_item_id', 'is', null);
  // Split (ADR-0048): anúncios de partições >0 vivem só em anuncios_externos; inclui seus ids
  // para o status ao vivo cobrir TODOS os anúncios do produto, não só a partição 0.
  const { data: extras } = await admin.from('anuncios_externos')
    .select('item_externo_id').eq('org_id', orgId).not('item_externo_id', 'is', null);
  const ids = [...new Set([
    ...(familias ?? []).map((f) => f.ml_item_id as string),
    ...(extras ?? []).map((e) => e.item_externo_id as string),
  ])];
  if (ids.length === 0) {
    return new Response(JSON.stringify({ itens: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Leitura de status em lote via conector (ADR-0024). getToken falha sem credencial ML →
  // lerStatus lança → semCredencialML. Erro de bloco vira 'indisponivel' (não trava a tela).
  const conn = getConnector('mercado_livre');
  // Token da conexão ML da org (E7), não a do chamador.
  const conexao = await resolverConexao(admin, orgId, 'mercado_livre');
  if (!conexao) {
    return new Response(JSON.stringify({ semCredencialML: true, itens: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const ctx = { getToken: () => getValidAccessTokenConexao(conexao) };
  let statusPorId: Record<string, StatusCanal>;
  try {
    statusPorId = await conn.lerStatus(ctx, ids);
  } catch {
    return new Response(JSON.stringify({ semCredencialML: true, itens: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const itens = ids.map((id) => ({ ml_item_id: id, ...statusPorId[id] }));
  return new Response(JSON.stringify({ itens }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
