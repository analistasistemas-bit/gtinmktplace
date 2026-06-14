import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUser } from '../_shared/auth.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import type { StatusCanal } from '../_shared/canais/contrato.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  let user;
  try { user = await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  const admin = adminClient();
  const { data: familias } = await admin.from('familias')
    .select('ml_item_id').eq('user_id', user.id).not('ml_item_id', 'is', null);
  const ids = [...new Set((familias ?? []).map((f) => f.ml_item_id as string))];
  if (ids.length === 0) {
    return new Response(JSON.stringify({ itens: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Leitura de status em lote via conector (ADR-0024). getToken falha sem credencial ML →
  // lerStatus lança → semCredencialML. Erro de bloco vira 'indisponivel' (não trava a tela).
  const conn = getConnector('mercado_livre');
  const ctx = { getToken: () => getValidAccessToken(user.id) };
  let statusPorId: Record<string, StatusCanal>;
  try {
    statusPorId = await conn.lerStatus(ctx, ids);
  } catch {
    return new Response(JSON.stringify({ semCredencialML: true, itens: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const itens = ids.map((id) => ({ ml_item_id: id, ...statusPorId[id] }));
  return new Response(JSON.stringify({ itens }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
