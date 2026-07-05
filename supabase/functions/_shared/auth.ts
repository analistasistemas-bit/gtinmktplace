import { adminClient } from './supabase.ts';
import { resolverOrgDoPerfil, type PerfilOrgRow } from './auth-org.ts';

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
export async function requireUserOrg(req: Request): Promise<{ userId: string; orgId: string; isAdmin: boolean }> {
  const user = await requireUser(req);
  const { data, error } = await adminClient()
    .from('profiles').select('org_id, is_active, is_admin').eq('id', user.id).single();
  if (error || !data) throw new Response(JSON.stringify({ error: 'perfil não encontrado' }), { status: 403 });
  try {
    const { orgId, isAdmin } = resolverOrgDoPerfil(data as PerfilOrgRow);
    return { userId: user.id, orgId, isAdmin };
  } catch {
    throw new Response(JSON.stringify({ error: 'perfil inativo ou sem organização' }), { status: 403 });
  }
}
