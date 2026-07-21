import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { queryClient } from '@/lib/query-client';

export interface Profile {
  id: string;
  is_admin: boolean;
  is_active: boolean;
  allowed_menus: string[];
  nome: string;
  org_id: string;
  is_super_admin: boolean;
}

interface LoadProfileOptions {
  blocking?: boolean;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  profileLoading: boolean;
  hydrate: () => Promise<void>;
  setSession: (s: Session | null) => void;
  loadProfile: (userId: string, options?: LoadProfileOptions) => Promise<void>;
}

let profileRequestGeneration = 0;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  loading: true,
  profile: null,
  profileLoading: true,
  hydrate: async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    set({ session: data.session, user, loading: false });
    if (user) {
      void get().loadProfile(user.id);
    } else {
      set({ profile: null, profileLoading: false });
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      const previousUserId = get().user?.id ?? null;
      const user = session?.user ?? null;
      if (!user) {
        // Logout: limpa o cache do react-query — sem isso, dados por-org (financeiro, publicação,
        // mensagens) ficam retidos em memória além do logout e podem vazar pra próxima conta que
        // logar na mesma aba (staleness client-side; a RLS do servidor continua protegendo).
        if (previousUserId) queryClient.clear();
        set({ session, user: null, profile: null, profileLoading: false });
        return;
      }

      const sameLoadedUser = previousUserId === user.id && !get().profileLoading;
      if (sameLoadedUser) {
        set({ session, user });
      } else {
        // Troca de conta na mesma aba (não só 1ª carga): mesmo motivo do logout acima.
        if (previousUserId && previousUserId !== user.id) queryClient.clear();
        set({ session, user, profile: null });
      }
      void get().loadProfile(user.id, { blocking: !sameLoadedUser });
    });
  },
  setSession: (session) => set({ session, user: session?.user ?? null }),
  loadProfile: async (userId, options = {}) => {
    const requestGeneration = ++profileRequestGeneration;
    const blocking = options.blocking ?? true;
    if (blocking) set({ profileLoading: true });
    const { data } = await supabase
      .from('profiles')
      .select('id,is_admin,is_active,allowed_menus,nome,org_id,is_super_admin')
      .eq('id', userId)
      .maybeSingle();
    if (
      requestGeneration !== profileRequestGeneration
      || get().user?.id !== userId
    ) return;
    set({ profile: (data as Profile) ?? null, profileLoading: false });
  },
}));
