import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { userClient } from '../_shared/supabase.ts';
import { redisSet } from '../_shared/redis/client.ts';
import { montarAuthUrl } from '../_shared/ml/auth-url.ts';

const STATE_TTL_S = 600; // 10 min

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return new Response('Missing auth', { status: 401, headers: corsHeaders });
  }
  const { data: { user } } = await userClient(auth.slice(7)).auth.getUser();
  if (!user) return new Response('Invalid token', { status: 401, headers: corsHeaders });

  const state = crypto.randomUUID();
  await redisSet(`oauth:ml:state:${state}`, user.id, STATE_TTL_S);

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
