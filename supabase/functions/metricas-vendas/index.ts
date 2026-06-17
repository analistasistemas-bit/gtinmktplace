import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUser } from '../_shared/auth.ts';
import { getValidAccessToken } from '../_shared/ml/token.ts';
import { getConnector } from '../_shared/canais/registry.ts';
import type { MetricasVendasCanal } from '../_shared/canais/contrato.ts';

interface Body { desde?: string; ate?: string }

// Agrega as vendas do período dos anúncios gerenciados pelo app (spec dashboard-kpis).
// Espelha status-publicados: o escopo são os ml_item_id do usuário; a leitura passa pelo
// conector de canal (multicanal). Sem credencial ML → semCredencialML (não trava a tela).
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let user;
  try { user = await requireUser(req); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }

  let body: Body;
  try { body = await req.json(); }
  catch { return new Response('Bad JSON', { status: 400, headers: corsHeaders }); }
  if (!body.desde || !body.ate) {
    return new Response('desde e ate obrigatórios', { status: 400, headers: corsHeaders });
  }

  const admin = adminClient();
  const { data: familias } = await admin.from('familias')
    .select('ml_item_id').eq('user_id', user.id).not('ml_item_id', 'is', null);
  const ids = [...new Set((familias ?? []).map((f) => f.ml_item_id as string))];

  const vazio: MetricasVendasCanal = { porItem: {}, totais: { faturamento: 0, unidades: 0, pedidos: 0 } };
  if (ids.length === 0) {
    return new Response(JSON.stringify(vazio), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const conn = getConnector('mercado_livre');
  const ctx = { getToken: () => getValidAccessToken(user.id) };
  let metricas: MetricasVendasCanal;
  try {
    metricas = await conn.lerMetricasVendas(ctx, { desde: body.desde, ate: body.ate }, ids);
  } catch {
    return new Response(
      JSON.stringify({ semCredencialML: true, ...vazio }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  return new Response(JSON.stringify(metricas), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
