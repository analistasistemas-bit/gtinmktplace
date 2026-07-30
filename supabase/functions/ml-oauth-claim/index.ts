// Confirma a conexão do Mercado Livre na org de QUEM ESTÁ AUTENTICADO (ADR-0091).
//
// Esta function existe porque o `state` do OAuth nunca provou quem completa o fluxo: um admin de
// qualquer org gerava a authUrl, mandava para um vendedor, e os tokens do vendedor eram gravados
// na org do atacante (achado F4). O callback agora só guarda o `code`; o vínculo com a org
// acontece aqui, contra a sessão real.
//
// INVARIANTE, e é o que um revisor consegue checar em uma linha:
//   esta function não lê org de lugar nenhum além do `requireUserOrg`.
// Nada de org_id vindo do corpo, do claim ou do state.
//
// `verify_jwt = false` no config.toml acompanha as irmãs de OAuth (start/callback/disconnect),
// todas com a checagem dentro da function — ver ADR-0091.
import { corsHeaders, handleOptions } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabase.ts';
import { requireUserOrg } from '../_shared/auth.ts';
import { auditarOperacaoSuporte } from '../_shared/support-audit.ts';
import { redisGetDel } from '../_shared/redis/client.ts';
import { trocarCodePorToken } from '../_shared/ml/token.ts';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

/**
 * `status.mercadoenvios` de GET /users/{id} fica desatualizado por um tempo após a adesão
 * (confirmado ao vivo: dizia "not_accepted" com o frete já funcionando) — a fonte confiável
 * em tempo real é shipping_preferences.modes conter "me2". null = não deu pra checar (best-effort).
 */
async function buscarMe2Habilitado(mlUserId: number, accessToken: string): Promise<boolean | null> {
  try {
    const r = await fetch(`https://api.mercadolibre.com/users/${mlUserId}/shipping_preferences`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return null;
    const j = await r.json() as { modes?: string[] };
    return Array.isArray(j.modes) ? j.modes.includes('me2') : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });

  let userId: string, orgId: string, isAdmin: boolean;
  let context: Awaited<ReturnType<typeof requireUserOrg>>;
try { ({ userId, orgId, isAdmin } = context = await requireUserOrg(req, { access: 'write' })); }
  catch (resp) { if (resp instanceof Response) return resp; throw resp; }
  // Conectar a conta ML afeta vendas/perguntas/devoluções de toda a org (ADR-0060).
if (!isAdmin && context.support?.scope !== 'full') {
    await auditarOperacaoSuporte(adminClient(), context, { type: 'org', id: orgId }, 'denied');
    return json({ erro: 'Somente administradores podem conectar a conta do Mercado Livre' }, 403);
  }

  const { claim_id } = await req.json().catch(() => ({}));
  if (!claim_id || typeof claim_id !== 'string') return json({ erro: 'claim_id obrigatório' }, 400);

  // Uso único e atômico: a segunda tentativa (F5, StrictMode, aba duplicada) não acha nada.
  const raw = await redisGetDel(`oauth:ml:claim:${claim_id}`);
  if (!raw) return json({ erro: 'expirado', mensagem: 'A confirmação expirou. Clique em Conectar para recomeçar.' }, 410);

  let code: string;
  try {
    const parsed = JSON.parse(raw) as { code?: string };
    if (!parsed.code) throw new Error('claim incompleto');
    code = parsed.code;
  } catch {
    return json({ erro: 'expirado', mensagem: 'A confirmação expirou. Clique em Conectar para recomeçar.' }, 410);
  }

  try {
    // O `code` é de uso único e já foi consumido do Redis: se o ML recusar (invalid_grant por
    // expirado/reusado), NÃO há como repetir daqui — o usuário refaz o consentimento.
    const tok = await trocarCodePorToken(code);
    const [nickname, me2Habilitado] = await Promise.all([
      buscarNickname(tok.user_id, tok.access_token),
      buscarMe2Habilitado(tok.user_id, tok.access_token),
    ]);
    const expiresAt = new Date(Date.now() + tok.expires_in * 1000).toISOString();

    const { error } = await adminClient().rpc('upsert_marketplace_connection', {
      p_org_id: orgId, // <- da SESSÃO. Nunca do state, nunca do corpo.
      p_canal: 'mercado_livre',
      p_conta_externa_id: String(tok.user_id),
      p_conta_label: nickname,
      p_access_token: tok.access_token,
      p_refresh_token: tok.refresh_token,
      p_scope: tok.scope ?? null,
      p_expires_at: expiresAt,
      p_criado_por: userId,
      p_me2_habilitado: me2Habilitado,
    });
    if (error) {
      // 23505 = índice único (canal, conta_externa_id): a conta ML pertence a outra org. Acontece
      // tanto no INSERT quanto no UPDATE da RPC, por isso a checagem é pelo SQLSTATE e não por
      // caminho.
      if ((error as { code?: string }).code === '23505') {
        await auditarOperacaoSuporte(adminClient(), context, { type: 'org', id: orgId }, 'failed');
        return json({
          erro: 'conta_em_outra_org',
          mensagem: 'Esta conta do Mercado Livre já está conectada em outra organização.',
        }, 409);
      }
      throw new Error(error.message);
    }

    // Metade do tripwire (ADR-0091): junta-se à linha do callback pelo claim_id. Nunca logar
    // o `code` nem os tokens.
    console.log(`ml-oauth-claim: claim ${claim_id} redimido (caller_org_id=${orgId}, ml_user_id=${tok.user_id})`);
    await auditarOperacaoSuporte(adminClient(), context, { type: 'connection', id: String(tok.user_id) }, 'succeeded');

    return json({ ok: true, conta: nickname }, 200);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('ml-oauth-claim erro:', msg);
    await auditarOperacaoSuporte(adminClient(), context, { type: 'org', id: orgId }, 'failed');
    return json({
      erro: 'token',
      mensagem: 'Não foi possível concluir a conexão. Clique em Conectar para recomeçar.',
    }, 400);
  }
});
