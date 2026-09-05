import { useAuthStore } from '@/stores/auth-store';

export function useProfile() {
  const profile = useAuthStore((s) => s.profile);
  const profileLoading = useAuthStore((s) => s.profileLoading);
  const profileOffline = useAuthStore((s) => s.profileOffline);
  return { profile, isAdmin: !!profile?.is_admin, profileLoading, profileOffline };
}
