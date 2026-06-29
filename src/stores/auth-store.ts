import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface Profile {
  id: string;
  is_admin: boolean;
  is_active: boolean;
  allowed_menus: string[];
  nome: string;
}

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  profile: Profile | null;
  profileLoading: boolean;
  hydrate: () => Promise<void>;
  setSession: (s: Session | null) => void;
  loadProfile: (userId: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
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
      set({ profileLoading: true });
      void useAuthStore.getState().loadProfile(user.id);
    } else {
      set({ profile: null, profileLoading: false });
    }
    supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      set({ session, user: u });
      if (u) {
        set({ profileLoading: true });
        void useAuthStore.getState().loadProfile(u.id);
      } else {
        set({ profile: null, profileLoading: false });
      }
    });
  },
  setSession: (session) => set({ session, user: session?.user ?? null }),
  loadProfile: async (userId) => {
    const { data } = await supabase
      .from('profiles')
      .select('id,is_admin,is_active,allowed_menus,nome')
      .eq('id', userId)
      .maybeSingle();
    set({ profile: (data as Profile) ?? null, profileLoading: false });
  },
}));
