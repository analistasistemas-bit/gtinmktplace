import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { userClient } from '../_shared/supabase.ts';
import { redisSet } from '../_shared/redis/client.ts';
import { assinarPublic } from '../_shared/shopee/assinatura.ts';
import { montarAuthUrlShopee, PATH_AUTH_PARTNER } from '../_shared/shopee/auth-url.ts';

// Espelha ml-oauth-start: exige usuário autenticado, gera um `state` (CSRF) em
// Redis e devolve a authUrl para o front redirecionar.
//
// Diferença Shopee: o fluxo `auth_partner` NÃO ecoa um `state` próprio — só
// devolve `code` + `shop_id`. Para recuperar o usuário no callback, embutimos o
// `state` na própria `redirect` URI (?state=...); a Shopee preserva a query do
// redirect e devolve code/shop_id anexados. Ver shopee-oauth-callback.
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
  await redisSet(`oauth:shopee:state:${state}`, user.id, STATE_TTL_S);

  const host = Deno.env.get('SHOPEE_HOST')!;
  const partnerId = Deno.env.get('SHOPEE_PARTNER_ID')!;
  const partnerKey = Deno.env.get('SHOPEE_PARTNER_KEY')!;
  const baseRedirect = Deno.env.get('SHOPEE_REDIRECT_URI')!;

  // `state` viaja dentro da redirect URI (a Shopee não tem param de state próprio).
  const redirectUri = `${baseRedirect}${baseRedirect.includes('?') ? '&' : '?'}state=${state}`;

  const timestamp = Math.floor(Date.now() / 1000);
  const sign = await assinarPublic({ partnerId, partnerKey }, PATH_AUTH_PARTNER, timestamp);
  const authUrl = montarAuthUrlShopee(host, partnerId, timestamp, sign, redirectUri);

  return new Response(JSON.stringify({ authUrl }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
