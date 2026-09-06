import { requireUser } from '../auth.ts';
import { adminClient } from '../supabase.ts';

export async function requirePlatformAdmin(req: Request): Promise<{ userId: string }> {
  const user = await requireUser(req);
  const { data, error } = await adminClient()
    .from('profiles')
    .select('is_super_admin,is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !data?.is_super_admin || !data.is_active) {
    throw new Response('Somente super-administradores ativos podem executar esta ação', { status: 403 });
  }

  return { userId: user.id };
}
