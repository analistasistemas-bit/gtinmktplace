import { adminClient } from './supabase.ts';

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
