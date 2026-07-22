import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { redisSet } from '../_shared/redis/client.ts';
import { montarAuthUrl } from '../_shared/ml/auth-url.ts';

const STATE_TTL_S = 600; // 10 min

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  let userId: string, orgId: string, isAdmin: boolean;
  try { ({ userId, orgId, isAdmin } = await requireUserOrg(req)); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  // Conectar a conta ML afeta vendas/perguntas/devoluções de toda a org — ação restrita a admin (ADR-0060).
  if (!isAdmin) return new Response('Somente administradores podem conectar a conta do Mercado Livre', { status: 403, headers: corsHeaders });

  const state = crypto.randomUUID();
  await redisSet(`oauth:ml:state:${state}`, JSON.stringify({ user_id: userId, org_id: orgId }), STATE_TTL_S);

  const authUrl = montarAuthUrl(
    state,
    Deno.env.get('ML_CLIENT_ID')!,
    Deno.env.get('ML_REDIRECT_URI')!,
  );

  return new Response(JSON.stringify({ authUrl }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
