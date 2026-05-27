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
