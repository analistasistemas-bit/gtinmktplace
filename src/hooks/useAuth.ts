import { useAuthStore } from '@/stores/auth-store';

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const session = useAuthStore((s) => s.session);
  const loading = useAuthStore((s) => s.loading);
  return { user, session, loading };
}
