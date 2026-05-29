import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface EstadoConexaoML {
  conectado: boolean;
  nickname: string | null;
  mlUserId: string | null;
}

export function useMlConnection() {
  return useQuery<EstadoConexaoML>({
    queryKey: ['ml-connection'],
    staleTime: 5 * 60 * 1000, // estado só muda por ação explícita; invalidamos no disconnect
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ml_credentials')
        .select('ml_nickname, ml_user_id')
        .maybeSingle();
      if (error) throw error;
      if (!data) return { conectado: false, nickname: null, mlUserId: null };
      return { conectado: true, nickname: data.ml_nickname, mlUserId: data.ml_user_id };
    },
  });
}
