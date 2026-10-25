import { adminClient } from './supabase.ts';
import { corsHeaders } from './cors.ts';
import { ERRO_SESSAO_SUPORTE, resolverAcessoOrg, resolverOrgDoPerfil, type PerfilOrgRow, type SupportAccess, type SupportSessionRow } from './auth-org.ts';

export { resolverOrgDoPerfil, type PerfilOrgRow };

// Respostas lançadas aqui são devolvidas cruas pelas edges: sem CORS o browser bloqueia o erro e o
// supabase-js mostra "Failed to send a request to the Edge Function" em vez da mensagem real.
function erro(mensagem: string, status: number, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: mensagem }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra },
  });
}

const SESSAO_EXPIRADA = 'Sessão expirada. Recarregue a página e entre de novo.';

export interface AuthedUser {
  id: string;
  email: string | null;
}

export async function requireUser(req: Request): Promise<AuthedUser> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw erro(SESSAO_EXPIRADA, 401);
  }
  const token = authHeader.slice('Bearer '.length);
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) {
    throw erro(SESSAO_EXPIRADA, 401);
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

// Gate mais estrito que requireUser: exige profiles.is_admin (ADR-0060 — pausar/reativar
// anúncio é a 1ª ação de escrita restrita a admin, não só a membro autenticado).
export async function requireAdmin(req: Request): Promise<AuthedUser> {
  const user = await requireUser(req);
  const { data } = await adminClient().from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
  if (!data?.is_admin) {
    throw erro('Somente administradores podem executar esta ação', 403);
  }
  return user;
}

/** Identidade completa do chamador autenticado: user + org (403 se inativo/sem org). */
export async function requireUserOrg(
  req: Request,
  options: { access?: SupportAccess } = {},
): Promise<{ userId: string; orgId: string; isAdmin: boolean; support: null | { requestId: string; scope: 'read' | 'full' } }> {
  const user = await requireUser(req);
  const access = options.access ?? 'read';
  const db = adminClient();
  const { data, error } = await db
    .from('profiles').select('org_id, is_active, is_admin, is_super_admin').eq('id', user.id).single();
  if (error || !data) throw erro('perfil não encontrado', 403);
  let session: SupportSessionRow | null = null;
  if (data.is_super_admin) {
    const { data: active } = await db.from('support_requests')
      .select('id, org_id, scope, status, expires_at')
      .eq('requester_id', user.id).eq('status', 'active')
      .gt('expires_at', new Date().toISOString()).maybeSingle();
    session = active as SupportSessionRow | null;
  }
  let resolved: ReturnType<typeof resolverAcessoOrg>;
  try { resolved = resolverAcessoOrg(data as PerfilOrgRow, session, access); }
  catch (e) {
    // Header só p/ a edge `extensao` distinguir sessão de suporte expirada (ADR-0189 D-18);
    // corpo inalterado para os demais chamadores.
    const headers = (e as Error).message === ERRO_SESSAO_SUPORTE ? { 'x-motivo': 'sessao_suporte' } : undefined;
    throw erro('perfil inativo ou sem organização', 403, headers);
  }
  return { userId: user.id, ...resolved };
}
