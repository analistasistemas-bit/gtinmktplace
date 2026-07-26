import { create } from 'zustand';
import { endSupport, fetchSupportContext, startSupport, type SupportContext } from '@/lib/suporte';
import { useAuthStore } from '@/stores/auth-store';

interface SupportState {
  context: SupportContext | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  loadContext: () => Promise<void>;
  start: (requestId: string) => Promise<void>;
  end: (requestId: string) => Promise<void>;
  clear: () => void;
}

export const useSupportStore = create<SupportState>((set, get) => ({
  context: null,
  loading: false,
  loaded: false,
  error: null,
  loadContext: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      set({ context: await fetchSupportContext(), loaded: true, error: null });
    } catch (error) {
      set({
        context: null,
        loaded: true,
        error: error instanceof Error ? error.message : 'Não foi possível carregar o contexto de suporte.',
      });
    } finally {
      set({ loading: false });
    }
  },
  start: async (requestId) => {
    await startSupport(requestId);
    await get().loadContext();
  },
  end: async (requestId) => {
    try {
      await endSupport(requestId);
    } finally {
      get().clear();
    }
  },
  clear: () => set({ context: null, loading: false, loaded: false, error: null }),
}));

export function effectiveOrgId(): string | null {
  return useSupportStore.getState().context?.orgId
    ?? useAuthStore.getState().profile?.org_id
    ?? null;
}

export function canWrite(): boolean {
  const { context } = useSupportStore.getState();
  return context ? context.scope === 'full' : effectiveOrgId() !== null;
}
