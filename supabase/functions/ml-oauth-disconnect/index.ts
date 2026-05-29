import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { userClient, adminClient } from '../_shared/supabase.ts';

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

  const { error } = await adminClient().rpc('delete_ml_credentials', { p_user_id: user.id });
  if (error) {
    console.error('delete_ml_credentials:', error.message);
    return new Response('Erro ao desconectar conta ML', { status: 500, headers: corsHeaders });
  }
  return new Response('OK', { status: 200, headers: corsHeaders });
});
