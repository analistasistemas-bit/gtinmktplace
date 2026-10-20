import { useSupportStore } from '@/stores/support-store';
import { useAuthStore } from '@/stores/auth-store';

/** Org efetiva reativa: contexto de suporte, senão a org do perfil. Entra nas chaves de cache por org. */
export function useOrgEfetivaId(): string | null {
  const suporte = useSupportStore((s) => s.context?.orgId);
  const doPerfil = useAuthStore((s) => s.profile?.org_id);
  return suporte ?? doPerfil ?? null;
}
