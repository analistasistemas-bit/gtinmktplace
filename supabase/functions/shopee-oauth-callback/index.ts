import { adminClient } from '../_shared/supabase.ts';
import { redisGet, redisDel } from '../_shared/redis/client.ts';
import { trocarCodePorToken } from '../_shared/shopee/token.ts';

// Espelha ml-oauth-callback: recebe o retorno do OAuth, troca code→token e
// persiste a credencial via Vault (upsert_shopee_credentials), redirecionando o
// operador de volta ao front.
//
// A Shopee devolve `?code=...&shop_id=...` (válidos ~5 min) + o `state` que
// embutimos na redirect URI (ver shopee-oauth-start). Recuperamos o usuário pelo
// `state` em Redis (uso único, CSRF).
const FRONTEND = 'https://ean2marketplace-frontend.onrender.com/#/configuracoes';

function redirect(query: string): Response {
  return new Response(null, { status: 302, headers: { Location: `${FRONTEND}?${query}` } });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const shopId = url.searchParams.get('shop_id');
  const state = url.searchParams.get('state');

  if (!code || !shopId || !state) return redirect('shopee_erro=state');

  const userId = await redisGet(`oauth:shopee:state:${state}`);
  if (!userId) return redirect('shopee_erro=state');
  await redisDel(`oauth:shopee:state:${state}`); // uso único

  try {
    const tok = await trocarCodePorToken(code, shopId);
    const expiresAt = new Date(Date.now() + tok.expire_in * 1000).toISOString();

    const { error } = await adminClient().rpc('upsert_shopee_credentials', {
      p_user_id: userId,
      p_shop_id: shopId,
      p_access_token: tok.access_token,
      p_refresh_token: tok.refresh_token,
      p_expires_at: expiresAt,
    });
    if (error) throw new Error(error.message);

    return redirect('shopee_conectado=true');
  } catch (e) {
    console.error('shopee-oauth-callback erro:', e instanceof Error ? e.message : String(e));
    return redirect('shopee_erro=token');
  }
});
