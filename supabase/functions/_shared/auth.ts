import { adminClient } from './supabase.ts';
import { resolverAcessoOrg, resolverOrgDoPerfil, type PerfilOrgRow, type SupportAccess, type SupportSessionRow } from './auth-org.ts';

export { resolverOrgDoPerfil, type PerfilOrgRow };

export interface AuthedUser {
  id: string;
  email: string | null;
}

export async function requireUser(req: Request): Promise<AuthedUser> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Response('Missing bearer token', { status: 401 });
  }
  const token = authHeader.slice('Bearer '.length);
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) {
    throw new Response('Invalid token', { status: 401 });
  }
  return { id: data.user.id, email: data.user.email ?? null };
}

// Gate mais estrito que requireUser: exige profiles.is_admin (ADR-0060 — pausar/reativar
// anúncio é a 1ª ação de escrita restrita a admin, não só a membro autenticado).
export async function requireAdmin(req: Request): Promise<AuthedUser> {
  const user = await requireUser(req);
  const { data } = await adminClient().from('profiles').select('is_admin').eq('id', user.id).maybeSingle();
  if (!data?.is_admin) {
    throw new Response('Somente administradores podem executar esta ação', { status: 403 });
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
  if (error || !data) throw new Response(JSON.stringify({ error: 'perfil não encontrado' }), { status: 403 });
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
  catch {
    throw new Response(JSON.stringify({ error: 'perfil inativo ou sem organização' }), { status: 403 });
  }
  return { userId: user.id, ...resolved };
}
