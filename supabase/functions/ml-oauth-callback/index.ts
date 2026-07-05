import { adminClient } from '../_shared/supabase.ts';
import { redisGet, redisDel } from '../_shared/redis/client.ts';
import { trocarCodePorToken } from '../_shared/ml/token.ts';

const FRONTEND = 'https://ean2marketplace-frontend.onrender.com/#/configuracoes';

function redirect(query: string): Response {
  return new Response(null, { status: 302, headers: { Location: `${FRONTEND}?${query}` } });
}

async function buscarNickname(mlUserId: number, accessToken: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.mercadolibre.com/users/${mlUserId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    const j = await r.json() as { nickname?: string };
    return j.nickname ?? null;
  } catch {
    return null; // nickname é best-effort
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) return redirect('ml_erro=state');

  const raw = await redisGet(`oauth:ml:state:${state}`);
  if (!raw) return redirect('ml_erro=state');
  await redisDel(`oauth:ml:state:${state}`); // uso único

  let userId: string, orgId: string;
  try {
    const parsed = JSON.parse(raw) as { user_id: string; org_id: string };
    if (!parsed.user_id || !parsed.org_id) throw new Error('state incompleto');
    userId = parsed.user_id;
    orgId = parsed.org_id;
  } catch {
    return redirect('ml_erro=state');
  }

  try {
    const tok = await trocarCodePorToken(code);
    const nickname = await buscarNickname(tok.user_id, tok.access_token);
    const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();

    const { error } = await adminClient().rpc('upsert_marketplace_connection', {
      p_org_id: orgId,
      p_canal: 'mercado_livre',
      p_conta_externa_id: String(tok.user_id),
      p_conta_label: nickname,
      p_access_token: tok.access_token,
      p_refresh_token: tok.refresh_token,
      p_scope: tok.scope ?? null,
      p_expires_at: expiresAt,
      p_criado_por: userId,
    });
    if (error) throw new Error(error.message);

    return redirect('ml_conectado=true');
  } catch (e) {
    console.error('ml-oauth-callback erro:', e instanceof Error ? e.message : String(e));
    return redirect('ml_erro=token');
  }
});
